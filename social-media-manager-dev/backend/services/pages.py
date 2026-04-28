from __future__ import annotations

from ..auth import require_roles
from ..integrations import (
    apply_global_meta_token_to_account,
    global_linkedin_status,
    missing_credential_fields,
    refresh_platform_token,
    require_meta_publish_token_normalization,
    should_use_live_posting,
    test_facebook_live,
    test_instagram_live,
    test_linkedin_live,
    test_pinterest_live,
    test_twitter_live,
    validate_instagram_account_binding,
    validate_linkedin_account_binding,
)
from ..models import AppSetting, Page, SocialAccount, build_page_stats_map, db
from ..planning import ensure_planning_sheet_for_page
from ..settings import global_linkedin_access_token, global_meta_user_token
from ..media import cleanup_unreferenced_uploads, collect_page_upload_refs, store_upload
from ..routes.common import (
    Any,
    Blueprint,
    GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
    SUPPORTED_PLATFORMS,
    get_json_body,
    joinedload,
    jsonify,
    jwt_required,
    parse_bool_query,
    parse_iso_datetime,
    request,
    utcnow,
)

def get_pages() -> Any:
    search = (request.args.get("q") or "").strip()
    include_accounts = parse_bool_query(request.args.get("include_accounts"), default=True)
    page_num = request.args.get("page", type=int)
    per_page = request.args.get("per_page", type=int)

    query = Page.query
    if search:
        pattern = f"%{search}%"
        query = query.filter((Page.name.ilike(pattern)) | (Page.description.ilike(pattern)))

    if include_accounts:
        query = query.options(joinedload(Page.social_accounts))
    query = query.order_by(Page.created_at.desc())

    if page_num is not None or per_page is not None:
        page_num = max(page_num or 1, 1)
        per_page = min(max(per_page or 25, 1), 100)
        pagination = query.paginate(page=page_num, per_page=per_page, error_out=False)
        page_items = list(pagination.items)
        page_ids = [item.id for item in page_items]
        stats_by_page = build_page_stats_map(page_ids)
        items = [
            item.to_dict(stats=stats_by_page.get(item.id), include_accounts=include_accounts)
            for item in page_items
        ]
        return jsonify(
            {
                "items": items,
                "total": pagination.total,
                "page": pagination.page,
                "per_page": pagination.per_page,
                "pages": pagination.pages,
            }
        )

    pages = query.all()
    page_ids = [page.id for page in pages]
    stats_by_page = build_page_stats_map(page_ids)
    return jsonify(
        [
            page.to_dict(stats=stats_by_page.get(page.id), include_accounts=include_accounts)
            for page in pages
        ]
    )

def create_page() -> Any:
    data = request.form
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip() or None
    linkedin_page_url = (data.get("linkedin_page_url") or "").strip() or None

    if not name:
        return jsonify({"error": "Page name is required."}), 400

    page = Page(name=name, description=description, linkedin_page_url=linkedin_page_url)
    image_file = request.files.get("image")
    if image_file and image_file.filename:
        page.image_path = store_upload(image_file)

    db.session.add(page)
    db.session.commit()
    ensure_planning_sheet_for_page(page.id)
    return jsonify(page.to_dict()), 201

def get_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    return jsonify(page.to_dict())

def update_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    data = request.form
    previous_image_path = page.image_path

    name = data.get("name")
    description = data.get("description")
    linkedin_page_url = data.get("linkedin_page_url")
    if name is not None:
        name = name.strip()
        if not name:
            return jsonify({"error": "Page name cannot be empty."}), 400
        page.name = name
    if description is not None:
        page.description = description.strip() or None
    if linkedin_page_url is not None:
        page.linkedin_page_url = str(linkedin_page_url).strip() or None

    image_file = request.files.get("image")
    if image_file and image_file.filename:
        page.image_path = store_upload(image_file)

    db.session.commit()
    cleanup_unreferenced_uploads({previous_image_path})
    return jsonify(page.to_dict())

def delete_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    page_refs = collect_page_upload_refs(page)
    db.session.delete(page)
    db.session.commit()
    cleanup_unreferenced_uploads(page_refs)
    return jsonify({"message": "Page deleted successfully."})

def add_social_account(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    data = get_json_body()

    platform = str(data.get("platform", "")).strip().lower()
    if platform not in SUPPORTED_PLATFORMS:
        return jsonify({"error": "Unsupported platform."}), 400

    existing = SocialAccount.query.filter_by(page_id=page_id, platform=platform).first()
    if existing:
        return jsonify({"error": f"{platform} account already exists for this page."}), 409

    account = SocialAccount(
        page_id=page_id,
        platform=platform,
        account_name=(data.get("account_name") or "").strip() or None,
        access_token=(data.get("access_token") or "").strip() or None,
        access_token_secret=(data.get("access_token_secret") or "").strip() or None,
        api_key=(data.get("api_key") or "").strip() or None,
        api_secret=(data.get("api_secret") or "").strip() or None,
        refresh_token=(data.get("refresh_token") or "").strip() or None,
        page_id_external=(data.get("page_id_external") or "").strip() or None,
        token_expires_at=parse_iso_datetime(data.get("token_expires_at")),
    )

    if platform in {"facebook", "instagram"}:
        if not global_meta_user_token() and not account.access_token:
            return jsonify({"error": "Provide a Meta token in Settings or in the account payload before connecting Facebook/Instagram."}), 400
        account.token_expires_at = None
        if global_meta_user_token():
            account.access_token = None
            account.refresh_token = None
    if platform == "linkedin":
        account.access_token = None
        account.refresh_token = None
        account.page_id_external = None
        account.token_expires_at = None
        account.test_status = "success"
        account.test_error = "LinkedIn is currently in manual assist mode. No API token or organization ID is required."

    db.session.add(account)
    try:
        if platform in {"facebook", "instagram"} and global_meta_user_token():
            apply_global_meta_token_to_account(account)
        elif platform == "linkedin":
            validate_linkedin_account_binding(account)
        else:
            require_meta_publish_token_normalization(account)
            validate_instagram_account_binding(account)
            validate_linkedin_account_binding(account)
    except Exception as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    db.session.commit()
    return jsonify(account.to_dict()), 201

def test_social_account(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    missing = missing_credential_fields(account)

    account.last_tested = utcnow()
    if missing:
        account.test_status = "failed"
        account.test_error = f"Missing required credential fields: {', '.join(missing)}"
        db.session.commit()
        return jsonify({"success": False, "error": account.test_error, "platform": account.platform}), 400

    if account.platform == "linkedin":
        account.test_status = "success"
        account.test_error = "LinkedIn manual assist mode is active. This connection does not use the LinkedIn API right now."
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "platform": account.platform,
                "message": account.test_error,
            }
        )

    if not should_use_live_posting(account.page_id):
        account.test_status = "success"
        account.test_error = None
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "platform": account.platform,
                "message": "Credentials look complete. Enable live_posting_enabled for full API validation.",
            }
        )

    try:
        if account.platform == "facebook":
            account_name = test_facebook_live(account)
        elif account.platform == "twitter":
            account_name = test_twitter_live(account)
        elif account.platform == "linkedin":
            account_name = test_linkedin_live(account)
        elif account.platform == "instagram":
            account_name = test_instagram_live(account)
        elif account.platform == "pinterest":
            account_name = test_pinterest_live(account)
        else:
            raise RuntimeError("Unsupported platform")

        account.account_name = account_name
        account.test_status = "success"
        account.test_error = None
        db.session.commit()
        return jsonify({"success": True, "platform": account.platform, "message": f"Connected as {account_name}"})
    except Exception as error:
        account.test_status = "failed"
        account.test_error = str(error)
        db.session.commit()
        return jsonify({"success": False, "platform": account.platform, "error": str(error)}), 400

def delete_social_account(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    db.session.delete(account)
    db.session.commit()
    return jsonify({"message": "Account deleted successfully."})

def update_social_account(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid account payload."}), 400

    previous_platform = account.platform
    previous_access_token = account.access_token
    previous_page_id_external = account.page_id_external

    platform = data.get("platform")
    if platform is not None:
        platform_normalized = str(platform).strip().lower()
        if platform_normalized not in SUPPORTED_PLATFORMS:
            return jsonify({"error": "Unsupported platform."}), 400

        conflict = SocialAccount.query.filter(
            SocialAccount.page_id == account.page_id,
            SocialAccount.platform == platform_normalized,
            SocialAccount.id != account.id,
        ).first()
        if conflict:
            return jsonify({"error": f"{platform_normalized} account already exists for this page."}), 409
        account.platform = platform_normalized

    text_fields = [
        "account_name",
        "access_token",
        "access_token_secret",
        "api_key",
        "api_secret",
        "refresh_token",
        "page_id_external",
    ]
    for field in text_fields:
        if field in data:
            raw_value = data.get(field)
            if raw_value is None:
                setattr(account, field, None)
            else:
                cleaned = str(raw_value).strip()
                setattr(account, field, cleaned or None)

    if "token_expires_at" in data:
        account.token_expires_at = parse_iso_datetime(data.get("token_expires_at"))

    if "is_active" in data:
        raw_active = data.get("is_active")
        if isinstance(raw_active, bool):
            account.is_active = raw_active
        else:
            account.is_active = str(raw_active).strip().lower() in {"1", "true", "yes", "on"}

    if account.platform in {"facebook", "instagram"}:
        if global_meta_user_token():
            account.access_token = None
            account.refresh_token = None
            account.token_expires_at = None
            try:
                apply_global_meta_token_to_account(account)
            except Exception as error:
                db.session.rollback()
                return jsonify({"error": str(error)}), 400
        else:
            try:
                require_meta_publish_token_normalization(account)
            except Exception as error:
                db.session.rollback()
                return jsonify({"error": str(error)}), 400

    if account.platform == "instagram":
        try:
            validate_instagram_account_binding(account)
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": str(error)}), 400

    if account.platform == "linkedin":
        account.access_token = None
        account.refresh_token = None
        account.page_id_external = None
        account.token_expires_at = None
        account.test_status = "success"
        account.test_error = "LinkedIn is currently in manual assist mode. No API token or organization ID is required."
    else:
        try:
            validate_linkedin_account_binding(account)
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": str(error)}), 400

    if previous_platform != account.platform or previous_access_token != account.access_token or previous_page_id_external != account.page_id_external:
        account.test_status = None
        account.test_error = None

    db.session.commit()
    return jsonify(account.to_dict())

def manual_refresh_token(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    try:
        refresh_platform_token(account)
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400

    response = account.to_dict()
    if account.platform == "linkedin" and global_linkedin_access_token():
        response["global_token"] = {
            "expires_at": global_linkedin_status().get("expires_at"),
            "refresh_expires_at": AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or None,
        }
    return jsonify(response)
