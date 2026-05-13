from __future__ import annotations

from ..auth import require_roles
from ..integrations import (
    global_linkedin_status,
    global_meta_status,
    set_global_linkedin_configuration,
    set_global_meta_user_token,
)
from ..models import AppSetting, Page, PageSetting, db
from ..settings import (
    DESIGNER_EMAIL_MAP_KEY,
    GLOBAL_WRITABLE_SETTING_KEYS,
    PAGE_OVERRIDEABLE_SETTING_KEYS,
    get_designer_email_map_setting_value,
    get_effective_settings,
    get_global_reference_sheet_payload,
    get_global_settings,
    get_page_override_settings,
    get_page_reference_sheet_payload,
    global_linkedin_access_token,
    global_linkedin_refresh_token,
    global_meta_user_token,
    normalize_global_reference_sheet_key,
    normalize_page_reference_sheet_key,
    normalize_timezone_name,
    parse_designer_email_map,
    save_global_reference_sheet_payload,
    save_page_reference_sheet_payload,
)
from ..routes.common import (
    Any,
    Blueprint,
    FACEBOOK_APP_ID_SETTING_KEY,
    FACEBOOK_APP_SECRET_SETTING_KEY,
    GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY,
    GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
    GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY,
    GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
    GLOBAL_META_USER_TOKEN_KEY,
    LEGACY_META_GLOBAL_USER_TOKEN_KEY,
    get_json_body,
    jsonify,
    jwt_required,
)

def get_settings() -> Any:
    payload = get_global_settings()
    payload["global_meta_user_token"] = global_meta_user_token() or ""
    payload[FACEBOOK_APP_ID_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or ""
    payload[FACEBOOK_APP_SECRET_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or ""
    payload["global_linkedin_access_token"] = global_linkedin_access_token() or ""
    payload["global_linkedin_refresh_token"] = global_linkedin_refresh_token() or ""
    payload["global_linkedin_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or ""
    payload["global_linkedin_refresh_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or ""
    payload["designer_email_map"] = get_designer_email_map_setting_value()
    payload["meta_global"] = global_meta_status()
    payload["linkedin_global"] = global_linkedin_status()
    return jsonify(payload)

def update_settings() -> Any:
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid settings payload."}), 400

    allowed = GLOBAL_WRITABLE_SETTING_KEYS
    invalid_keys = [key for key in data.keys() if key not in allowed]
    if invalid_keys:
        return jsonify({"error": f"Unsupported setting keys: {', '.join(invalid_keys)}"}), 400

    propagation_warnings: list[str] = []
    meta_token_result: dict[str, Any] | None = None
    linkedin_token_result: dict[str, Any] | None = None
    meta_token_supplied = (
        GLOBAL_META_USER_TOKEN_KEY in data or LEGACY_META_GLOBAL_USER_TOKEN_KEY in data
    )
    linkedin_token_supplied = any(
        key in data
        for key in {
            GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY,
            GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY,
            GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
            GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
        }
    )
    current_meta_token = (global_meta_user_token() or "").strip()
    current_meta_app_id = str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "").strip()
    current_meta_app_secret = str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "").strip()
    supplied_meta_token = str(
        data.get(GLOBAL_META_USER_TOKEN_KEY, data.get(LEGACY_META_GLOBAL_USER_TOKEN_KEY, "")) or ""
    ).strip()
    meta_token_changed = supplied_meta_token != current_meta_token
    supplied_meta_app_id = str(data.get(FACEBOOK_APP_ID_SETTING_KEY, current_meta_app_id) or "").strip()
    supplied_meta_app_secret = str(data.get(FACEBOOK_APP_SECRET_SETTING_KEY, current_meta_app_secret) or "").strip()
    meta_credentials_changed = (
        supplied_meta_app_id != current_meta_app_id
        or supplied_meta_app_secret != current_meta_app_secret
    )
    current_linkedin_token = (global_linkedin_access_token() or "").strip()
    current_linkedin_refresh = (global_linkedin_refresh_token() or "").strip()
    current_linkedin_expires = str(AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or "").strip()
    current_linkedin_refresh_expires = str(AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or "").strip()
    supplied_linkedin_token = str(data.get(GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY, current_linkedin_token) or "").strip()
    supplied_linkedin_refresh = str(data.get(GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY, current_linkedin_refresh) or "").strip()
    supplied_linkedin_expires = str(data.get(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, current_linkedin_expires) or "").strip()
    supplied_linkedin_refresh_expires = str(
        data.get(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, current_linkedin_refresh_expires) or ""
    ).strip()
    linkedin_token_changed = (
        supplied_linkedin_token != current_linkedin_token
        or supplied_linkedin_refresh != current_linkedin_refresh
        or supplied_linkedin_expires != current_linkedin_expires
        or supplied_linkedin_refresh_expires != current_linkedin_refresh_expires
    )
    for key, value in data.items():
        if key in {
            GLOBAL_META_USER_TOKEN_KEY,
            LEGACY_META_GLOBAL_USER_TOKEN_KEY,
            GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY,
            GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY,
            GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
            GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
        }:
            continue
        if key == DESIGNER_EMAIL_MAP_KEY:
            try:
                parse_designer_email_map(str(value or ""))
            except ValueError as error:
                return jsonify({"error": str(error)}), 400
        if key == "timezone":
            normalized = normalize_timezone_name(str(value))
            if not normalized:
                return jsonify({"error": "Invalid timezone. Use a valid IANA timezone, e.g. Africa/Johannesburg."}), 400
            value = normalized
        AppSetting.set_setting(key, str(value), commit=False)
    if (meta_token_supplied and meta_token_changed) or (meta_credentials_changed and (supplied_meta_token or current_meta_token)):
        try:
            propagation_warnings = set_global_meta_user_token(
                supplied_meta_token if meta_token_supplied else current_meta_token
            )
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": str(error)}), 400
    if linkedin_token_supplied and linkedin_token_changed:
        try:
            propagation_warnings.extend(
                set_global_linkedin_configuration(
                    supplied_linkedin_token,
                    supplied_linkedin_refresh,
                    supplied_linkedin_expires,
                    supplied_linkedin_refresh_expires,
                )
            )
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": str(error)}), 400
    meta_normalized = (meta_token_supplied and meta_token_changed) or (
        meta_credentials_changed and (supplied_meta_token or current_meta_token)
    )
    if not (meta_normalized or (linkedin_token_supplied and linkedin_token_changed)):
        db.session.commit()

    payload = get_global_settings()
    payload["global_meta_user_token"] = global_meta_user_token() or ""
    payload[FACEBOOK_APP_ID_SETTING_KEY] = current_meta_app_id if FACEBOOK_APP_ID_SETTING_KEY not in data else str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "")
    payload[FACEBOOK_APP_SECRET_SETTING_KEY] = current_meta_app_secret if FACEBOOK_APP_SECRET_SETTING_KEY not in data else str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "")
    payload["global_linkedin_access_token"] = global_linkedin_access_token() or ""
    payload["global_linkedin_refresh_token"] = global_linkedin_refresh_token() or ""
    payload["global_linkedin_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or ""
    payload["global_linkedin_refresh_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or ""
    payload["designer_email_map"] = get_designer_email_map_setting_value()
    payload["meta_global"] = global_meta_status()
    payload["linkedin_global"] = global_linkedin_status()
    if meta_normalized:
        stored_meta_token = payload["global_meta_user_token"]
        meta_status = payload["meta_global"]
        if meta_token_supplied and not supplied_meta_token:
            meta_token_result = {
                "message": "Global Meta token cleared.",
                "outcome": "cleared",
            }
        elif stored_meta_token and stored_meta_token != (supplied_meta_token or current_meta_token):
            if meta_status.get("expiry_known"):
                suffix = " This countdown is estimated at 50 days because Meta did not return an expiry date." if meta_status.get("expiry_assumed") else ""
                meta_token_result = {
                    "message": f"Meta token exchanged to a long-lived token. Time left: {meta_status.get('time_left_text') or 'unknown'}.{suffix}",
                    "outcome": "exchanged",
                }
            else:
                meta_token_result = {
                    "message": "Meta token was exchanged or normalized successfully and the stored token changed, but Meta did not return an expiry date. The exchange succeeded; remaining lifetime is unknown.",
                    "outcome": "normalized",
                }
        elif meta_status.get("expiry_known"):
            meta_token_result = {
                "message": f"Meta token saved. Time left: {meta_status.get('time_left_text') or 'unknown'}.",
                "outcome": "saved",
            }
        else:
            meta_token_result = {
                "message": "Meta token saved, but Meta did not return an expiry date. The app cannot confirm from Meta whether the submitted token was exchanged or simply accepted as already usable.",
                "outcome": "saved_without_expiry",
            }
        payload["meta_token_result"] = meta_token_result
    if linkedin_token_supplied and linkedin_token_changed:
        linkedin_status = payload["linkedin_global"]
        if not supplied_linkedin_token:
            linkedin_token_result = {
                "message": "Global LinkedIn token cleared.",
                "outcome": "cleared",
            }
        elif linkedin_status.get("expires_at"):
            linkedin_token_result = {
                "message": f"LinkedIn token saved successfully. Time left: {linkedin_status.get('time_left_text') or 'unknown'}.",
                "outcome": "saved",
            }
        else:
            linkedin_token_result = {
                "message": "LinkedIn token saved successfully. Expiry is unknown until LinkedIn returns or you supply it.",
                "outcome": "saved_without_expiry",
            }
        payload["linkedin_token_result"] = linkedin_token_result
    payload["message"] = "Settings updated successfully."
    if propagation_warnings:
        payload["warnings"] = propagation_warnings
    return jsonify(payload)

def get_page_settings(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    global_settings = get_global_settings()
    global_settings["global_meta_user_token"] = global_meta_user_token() or ""
    global_settings[FACEBOOK_APP_ID_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or ""
    global_settings[FACEBOOK_APP_SECRET_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or ""
    global_settings["global_linkedin_access_token"] = global_linkedin_access_token() or ""
    global_settings["global_linkedin_refresh_token"] = global_linkedin_refresh_token() or ""
    global_settings["global_linkedin_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or ""
    global_settings["global_linkedin_refresh_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or ""
    global_settings["designer_email_map"] = get_designer_email_map_setting_value()
    page_overrides = get_page_override_settings(page.id)
    effective_settings = global_settings.copy()
    effective_settings.update(page_overrides)

    return jsonify(
        {
            "scope": {"type": "page", "page_id": page.id, "page_name": page.name},
            "global_defaults": global_settings,
            "overrides": page_overrides,
            "effective": effective_settings,
            "meta_global": global_meta_status(),
            "linkedin_global": global_linkedin_status(),
        }
    )

def update_page_settings(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid settings payload."}), 400

    invalid_keys = [key for key in data.keys() if key not in PAGE_OVERRIDEABLE_SETTING_KEYS]
    if invalid_keys:
        return jsonify({"error": f"Unsupported page setting keys: {', '.join(invalid_keys)}"}), 400

    for key, value in data.items():
        if key == "timezone":
            normalized = normalize_timezone_name(str(value))
            if not normalized:
                return jsonify({"error": "Invalid timezone. Use a valid IANA timezone, e.g. Africa/Johannesburg."}), 400
            value = normalized
        PageSetting.set_setting(page.id, key, str(value), commit=False)
    db.session.commit()

    return jsonify(
        {
            "message": "Page settings updated successfully.",
            "effective": get_effective_settings(page.id),
            "overrides": get_page_override_settings(page.id),
        }
    )

def get_page_reference_sheet(page_id: int, sheet_key: str) -> Any:
    page = Page.query.get_or_404(page_id)
    normalized_key = normalize_page_reference_sheet_key(sheet_key)
    if not normalized_key:
        return jsonify({"error": "Unknown page sheet."}), 404

    payload = get_page_reference_sheet_payload(page.id, normalized_key)
    payload["page_id"] = page.id
    payload["page_name"] = page.name
    payload["message"] = "Page sheet loaded successfully."
    return jsonify(payload)

def update_page_reference_sheet(page_id: int, sheet_key: str) -> Any:
    page = Page.query.get_or_404(page_id)
    normalized_key = normalize_page_reference_sheet_key(sheet_key)
    if not normalized_key:
        return jsonify({"error": "Unknown page sheet."}), 404

    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid page sheet payload."}), 400

    try:
        payload = save_page_reference_sheet_payload(page.id, normalized_key, data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    db.session.commit()
    payload["page_id"] = page.id
    payload["page_name"] = page.name
    payload["message"] = "Page sheet updated successfully."
    return jsonify(payload)

def get_global_reference_sheet(sheet_key: str) -> Any:
    normalized_key = normalize_global_reference_sheet_key(sheet_key)
    if not normalized_key:
        return jsonify({"error": "Unknown reference sheet."}), 404

    payload = get_global_reference_sheet_payload(normalized_key)
    payload["scope_label"] = "Pages"
    payload["message"] = "Reference sheet loaded successfully."
    return jsonify(payload)

def update_global_reference_sheet(sheet_key: str) -> Any:
    normalized_key = normalize_global_reference_sheet_key(sheet_key)
    if not normalized_key:
        return jsonify({"error": "Unknown reference sheet."}), 404

    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid reference sheet payload."}), 400

    try:
        payload = save_global_reference_sheet_payload(normalized_key, data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    db.session.commit()
    payload["scope_label"] = "Pages"
    payload["message"] = "Reference sheet updated successfully."
    return jsonify(payload)
