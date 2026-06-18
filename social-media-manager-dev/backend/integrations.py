from __future__ import annotations

from . import app as core
from .models import AppSetting, Page, SocialAccount, db
from .publishing import *
from .settings import *

Any = core.Any
API_TIMEOUT_SECONDS = core.API_TIMEOUT_SECONDS
APP_TIMEZONE_NAME = core.APP_TIMEZONE_NAME
FACEBOOK_APP_ID_SETTING_KEY = core.FACEBOOK_APP_ID_SETTING_KEY
FACEBOOK_APP_SECRET_SETTING_KEY = core.FACEBOOK_APP_SECRET_SETTING_KEY
GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY = core.GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY
GLOBAL_LINKEDIN_LAST_CHECKED_KEY = core.GLOBAL_LINKEDIN_LAST_CHECKED_KEY
GLOBAL_LINKEDIN_LAST_REFRESHED_KEY = core.GLOBAL_LINKEDIN_LAST_REFRESHED_KEY
GLOBAL_LINKEDIN_MEMBER_NAME_KEY = core.GLOBAL_LINKEDIN_MEMBER_NAME_KEY
GLOBAL_LINKEDIN_MEMBER_URN_KEY = core.GLOBAL_LINKEDIN_MEMBER_URN_KEY
GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY = core.GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY
GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY = core.GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY
GLOBAL_LINKEDIN_SCOPES_KEY = core.GLOBAL_LINKEDIN_SCOPES_KEY
GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY = core.GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY
GLOBAL_META_USER_TOKEN_KEY = core.GLOBAL_META_USER_TOKEN_KEY
LEGACY_META_GLOBAL_USER_TOKEN_KEY = core.LEGACY_META_GLOBAL_USER_TOKEN_KEY
LINKEDIN_ALLOWED_ORG_POST_ROLES = core.LINKEDIN_ALLOWED_ORG_POST_ROLES
LINKEDIN_API_VERSION = core.LINKEDIN_API_VERSION
LINKEDIN_GLOBAL_WARNING_DAYS = core.LINKEDIN_GLOBAL_WARNING_DAYS
META_GLOBAL_ASSUMED_LIFETIME_DAYS = core.META_GLOBAL_ASSUMED_LIFETIME_DAYS
META_GLOBAL_EXPIRY_ASSUMED_KEY = core.META_GLOBAL_EXPIRY_ASSUMED_KEY
META_GLOBAL_LAST_CHECKED_KEY = core.META_GLOBAL_LAST_CHECKED_KEY
META_GLOBAL_LAST_REFRESHED_KEY = core.META_GLOBAL_LAST_REFRESHED_KEY
META_GLOBAL_TOKEN_EXPIRES_AT_KEY = core.META_GLOBAL_TOKEN_EXPIRES_AT_KEY
META_GLOBAL_WARNING_DAYS = core.META_GLOBAL_WARNING_DAYS
OAuth1 = core.OAuth1
datetime = core.datetime
json = core.json
logger = core.logger
os = core.os
parse_iso_datetime = core.parse_iso_datetime
requests = core.requests
timedelta = core.timedelta
utcnow = core.utcnow

def format_duration_words(total_seconds: int | float | None) -> str | None:
    if total_seconds is None:
        return None
    remaining = max(int(total_seconds), 0)
    days, remainder = divmod(remaining, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes = remainder // 60
    parts: list[str] = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes and not days:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    if not parts:
        parts.append("less than a minute")
    return ", ".join(parts[:2])


def global_meta_status() -> dict[str, Any]:
    token = global_meta_user_token()
    expires_at = parse_iso_datetime(AppSetting.get_setting(META_GLOBAL_TOKEN_EXPIRES_AT_KEY))
    last_refreshed = parse_iso_datetime(AppSetting.get_setting(META_GLOBAL_LAST_REFRESHED_KEY))
    last_checked = parse_iso_datetime(AppSetting.get_setting(META_GLOBAL_LAST_CHECKED_KEY))
    expiry_assumed = str(AppSetting.get_setting(META_GLOBAL_EXPIRY_ASSUMED_KEY, "") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    days_until_expiry = None
    needs_refresh = False
    seconds_until_expiry = None
    expiry_known = False
    status = "missing"
    if expires_at:
        remaining_seconds = (expires_at - utcnow()).total_seconds()
        seconds_until_expiry = max(int(remaining_seconds), 0)
        expiry_known = True
        if remaining_seconds <= 0:
            days_until_expiry = 0
            status = "expired"
        else:
            days_until_expiry = int((remaining_seconds + 86399) // 86400)
            status = "active"
        needs_refresh = remaining_seconds < META_GLOBAL_WARNING_DAYS * 86400
    elif token:
        status = "configured_no_expiry"
    return {
        "configured": bool(token),
        "token_preview": f"{token[:14]}..." if token else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "last_refreshed": last_refreshed.isoformat() if last_refreshed else None,
        "last_checked": last_checked.isoformat() if last_checked else None,
        "days_until_expiry": days_until_expiry,
        "seconds_until_expiry": seconds_until_expiry,
        "expiry_known": expiry_known,
        "expiry_assumed": expiry_assumed,
        "time_left_text": format_duration_words(seconds_until_expiry),
        "status": status,
        "needs_refresh": needs_refresh,
    }

def linkedin_api_headers(
    access_token: str,
    *,
    json_content: bool = False,
    include_version: bool = True,
    include_restli: bool = True,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {access_token}"}
    if include_version:
        headers["LinkedIn-Version"] = LINKEDIN_API_VERSION
    if include_restli:
        headers["X-Restli-Protocol-Version"] = "2.0.0"
    if json_content:
        headers["Content-Type"] = "application/json"
    if extra:
        headers.update(extra)
    return headers


def linkedin_api_request(
    method: str,
    path: str,
    access_token: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    include_version: bool = True,
    include_restli: bool = True,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = path if path.startswith("http") else f"https://api.linkedin.com{path}"
    response = requests.request(
        method,
        url,
        params=params,
        json=json_body,
        data=data,
        headers=linkedin_api_headers(
            access_token,
            json_content=json_body is not None,
            include_version=include_version,
            include_restli=include_restli,
            extra=extra_headers,
        ),
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "LinkedIn")


def normalize_linkedin_organization_urn(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    if cleaned.startswith("urn:li:organization:"):
        return cleaned
    if cleaned.isdigit():
        return f"urn:li:organization:{cleaned}"
    return None


def linkedin_organization_id(value: str | None) -> str | None:
    urn = normalize_linkedin_organization_urn(value)
    if not urn:
        return None
    return urn.rsplit(":", 1)[-1]


def fetch_linkedin_member_profile(access_token: str) -> dict[str, Any]:
    response = requests.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "LinkedIn")


def fetch_linkedin_organization_access_roles(access_token: str) -> list[dict[str, Any]]:
    payload = linkedin_api_request(
        "GET",
        "/rest/organizationAcls",
        access_token,
        params={"q": "roleAssignee", "state": "APPROVED", "count": 100},
    )
    elements = payload.get("elements")
    return elements if isinstance(elements, list) else []


def fetch_linkedin_organization(access_token: str, organization_urn: str) -> dict[str, Any]:
    organization_id = linkedin_organization_id(organization_urn)
    if not organization_id:
        raise RuntimeError("LinkedIn organization ID/URN is invalid.")
    return linkedin_api_request("GET", f"/rest/organizations/{organization_id}", access_token)


def extract_linkedin_organization_name(payload: dict[str, Any]) -> str | None:
    for candidate in (payload.get("localizedName"), payload.get("name")):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def validate_linkedin_organization_access(access_token: str, organization_urn: str) -> list[str]:
    roles: list[str] = []
    accessible_orgs: list[str] = []
    for item in fetch_linkedin_organization_access_roles(access_token):
        if not isinstance(item, dict):
            continue
        org_value = str(item.get("organization") or "").strip()
        role_value = str(item.get("role") or "").strip().upper()
        state_value = str(item.get("state") or "").strip().upper()
        if state_value != "APPROVED" or not org_value:
            continue
        if org_value not in accessible_orgs:
            accessible_orgs.append(org_value)
        if org_value == organization_urn and role_value:
            roles.append(role_value)

    if any(role in LINKEDIN_ALLOWED_ORG_POST_ROLES for role in roles):
        return roles

    hint = ""
    if accessible_orgs:
        hint = f" Accessible organizations for this token: {', '.join(accessible_orgs[:5])}."
    raise RuntimeError(
        "LinkedIn token does not have posting rights for "
        f"{organization_urn}. Required org role: ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER, or CONTENT_ADMINISTRATOR.{hint}"
    )


def global_linkedin_status() -> dict[str, Any]:
    token = global_linkedin_access_token()
    expires_at = parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY))
    refresh_expires_at = parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY))
    last_refreshed = parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_LAST_REFRESHED_KEY))
    last_checked = parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_LAST_CHECKED_KEY))
    member_urn = (AppSetting.get_setting(GLOBAL_LINKEDIN_MEMBER_URN_KEY, "") or "").strip() or None
    member_name = (AppSetting.get_setting(GLOBAL_LINKEDIN_MEMBER_NAME_KEY, "") or "").strip() or None
    scopes_raw = (AppSetting.get_setting(GLOBAL_LINKEDIN_SCOPES_KEY, "") or "").strip()
    scopes = [scope for scope in scopes_raw.split(" ") if scope]

    seconds_until_expiry = None
    days_until_expiry = None
    needs_refresh = False
    status = "missing"
    if expires_at:
        remaining_seconds = (expires_at - utcnow()).total_seconds()
        seconds_until_expiry = max(int(remaining_seconds), 0)
        if remaining_seconds <= 0:
            days_until_expiry = 0
            status = "expired"
        else:
            days_until_expiry = int((remaining_seconds + 86399) // 86400)
            status = "active"
        needs_refresh = remaining_seconds < LINKEDIN_GLOBAL_WARNING_DAYS * 86400
    elif token:
        status = "configured_no_expiry"

    return {
        "configured": bool(token),
        "token_preview": f"{token[:14]}..." if token else None,
        "status": status,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "refresh_expires_at": refresh_expires_at.isoformat() if refresh_expires_at else None,
        "seconds_until_expiry": seconds_until_expiry,
        "days_until_expiry": days_until_expiry,
        "time_left_text": format_duration_words(seconds_until_expiry),
        "needs_refresh": needs_refresh,
        "has_refresh_token": bool(global_linkedin_refresh_token()),
        "member_urn": member_urn,
        "member_name": member_name,
        "scopes": scopes,
        "last_refreshed": last_refreshed.isoformat() if last_refreshed else None,
        "last_checked": last_checked.isoformat() if last_checked else None,
    }

def missing_credential_fields(account: SocialAccount) -> list[str]:
    missing: list[str] = []

    if account.platform in {"facebook", "pinterest"} and not account.access_token:
        missing.append("access_token")

    if account.platform == "twitter":
        for key_name, value in {
            "api_key": account.api_key,
            "api_secret": account.api_secret,
            "access_token": account.access_token,
            "access_token_secret": account.access_token_secret,
        }.items():
            if not value:
                missing.append(key_name)

    if account.platform == "instagram":
        if not account.access_token:
            missing.append("access_token")
        if not account.page_id_external:
            missing.append("page_id_external (Instagram business account ID)")

    return missing


def test_facebook_live(account: SocialAccount) -> str:
    target_id = account.page_id_external or "me"
    response = requests.get(
        f"https://graph.facebook.com/v25.0/{target_id}",
        params={"fields": "id,name", "access_token": account.access_token},
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    return payload.get("name") or payload.get("id") or "facebook-account"


def test_twitter_live(account: SocialAccount) -> str:
    response = requests.get(
        "https://api.x.com/2/users/me",
        auth=twitter_oauth1(account),
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Twitter")
    data = payload.get("data", {})
    return data.get("username") or data.get("id") or "twitter-account"


def test_linkedin_live(account: SocialAccount) -> str:
    return account.account_name or (account.page.name if account.page else None) or "linkedin-manual"


def validate_linkedin_account_binding(account: SocialAccount) -> None:
    return


def fetch_instagram_business_account(access_token: str, ig_user_id: str) -> dict[str, Any]:
    response = requests.get(
        f"https://graph.facebook.com/v25.0/{ig_user_id}",
        params={
            "fields": "id,username",
            "access_token": access_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "Instagram")


def discover_accessible_instagram_accounts(access_token: str, limit: int = 5) -> list[str]:
    response = requests.get(
        "https://graph.facebook.com/v25.0/me/accounts",
        params={
            "fields": "id,name,instagram_business_account{id,username}",
            "access_token": access_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    results: list[str] = []
    for item in payload.get("data", []):
        if not isinstance(item, dict):
            continue
        ig_account = item.get("instagram_business_account")
        if not isinstance(ig_account, dict):
            continue
        ig_id = str(ig_account.get("id") or "").strip()
        if not ig_id:
            continue
        username = str(ig_account.get("username") or item.get("name") or "").strip()
        results.append(f"{ig_id}{f' ({username})' if username else ''}")
        if len(results) >= limit:
            break
    return results


def validate_instagram_account_binding(account: SocialAccount) -> None:
    if account.platform != "instagram":
        return
    if not account.access_token or not account.page_id_external:
        return

    try:
        payload = fetch_instagram_business_account(account.access_token, account.page_id_external)
    except Exception as error:
        try:
            options = discover_accessible_instagram_accounts(account.access_token)
        except Exception:
            options = []
        hint = (
            f" Accessible Instagram business accounts for this token include: {', '.join(options)}."
            if options
            else " The token does not appear to expose any Instagram business accounts via /me/accounts."
        )
        raise RuntimeError(
            f"Instagram business account ID {account.page_id_external} is not accessible with this token.{hint}"
        ) from error

    username = payload.get("username")
    if username:
        account.account_name = account.account_name or str(username)


def apply_global_meta_token_to_account(account: SocialAccount) -> None:
    if account.platform not in {"facebook", "instagram"}:
        return

    shared_token = global_meta_user_token()
    if not shared_token:
        raise RuntimeError("Set the global Meta user token in Settings before configuring Facebook or Instagram.")

    if account.platform == "instagram":
        account.access_token = shared_token
        account.token_expires_at = parse_iso_datetime(AppSetting.get_setting(META_GLOBAL_TOKEN_EXPIRES_AT_KEY))
        validate_instagram_account_binding(account)
        account.last_refreshed = utcnow()
        return

    if not account.page_id_external:
        raise RuntimeError("Facebook page_id_external is required to derive a Page access token.")

    page_token, page_name = resolve_facebook_page_access_token(shared_token, account.page_id_external)
    account.access_token = page_token
    account.token_expires_at = None
    account.last_refreshed = utcnow()
    if page_name:
        account.account_name = account.account_name or page_name


def apply_global_linkedin_token_to_account(account: SocialAccount) -> None:
    if account.platform != "linkedin":
        return

    shared_token = global_linkedin_access_token()
    if not shared_token:
        raise RuntimeError("Set the global LinkedIn token in Settings before configuring LinkedIn pages.")

    account.access_token = shared_token
    account.refresh_token = global_linkedin_refresh_token()
    account.token_expires_at = parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY))
    account.last_refreshed = utcnow()
    validate_linkedin_account_binding(account)


def propagate_global_meta_user_token() -> list[str]:
    shared_token = global_meta_user_token()
    if not shared_token:
        return []

    warnings: list[str] = []
    accounts = SocialAccount.query.filter(SocialAccount.platform.in_(["facebook", "instagram"])).all()
    for account in accounts:
        try:
            apply_global_meta_token_to_account(account)
            account.test_error = None
        except Exception as error:
            message = f"{account.platform} account {account.id}: {error}"
            warnings.append(message)
            account.test_error = str(error)
            logger.warning("Global Meta token propagation issue for account %s: %s", account.id, error)
    db.session.commit()
    return warnings


def update_global_linkedin_status_metadata(
    *,
    expires_at: datetime | None = None,
    refresh_expires_at: datetime | None = None,
    last_refreshed: datetime | None = None,
    last_checked: datetime | None = None,
    member_urn: str | None = None,
    member_name: str | None = None,
    scopes: list[str] | None = None,
    commit: bool = False,
) -> None:
    set_app_setting_value(
        GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
        expires_at.isoformat() if expires_at is not None else "",
        commit=False,
    )
    set_app_setting_value(
        GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
        refresh_expires_at.isoformat() if refresh_expires_at is not None else "",
        commit=False,
    )
    if last_refreshed is not None:
        set_app_setting_value(GLOBAL_LINKEDIN_LAST_REFRESHED_KEY, last_refreshed.isoformat(), commit=False)
    if last_checked is not None:
        set_app_setting_value(GLOBAL_LINKEDIN_LAST_CHECKED_KEY, last_checked.isoformat(), commit=False)
    if member_urn is not None:
        set_app_setting_value(GLOBAL_LINKEDIN_MEMBER_URN_KEY, member_urn, commit=False)
    if member_name is not None:
        set_app_setting_value(GLOBAL_LINKEDIN_MEMBER_NAME_KEY, member_name, commit=False)
    if scopes is not None:
        set_app_setting_value(GLOBAL_LINKEDIN_SCOPES_KEY, " ".join(scopes), commit=False)
    if commit:
        db.session.commit()


def propagate_global_linkedin_token() -> list[str]:
    shared_token = global_linkedin_access_token()
    if not shared_token:
        return []

    warnings: list[str] = []
    accounts = SocialAccount.query.filter_by(platform="linkedin").all()
    for account in accounts:
        try:
            apply_global_linkedin_token_to_account(account)
            account.test_error = None
        except Exception as error:
            message = f"linkedin account {account.id}: {error}"
            warnings.append(message)
            account.test_error = str(error)
            logger.warning("Global LinkedIn token propagation issue for account %s: %s", account.id, error)
    db.session.commit()
    return warnings


def set_global_linkedin_configuration(
    raw_access_token: str | None,
    raw_refresh_token: str | None = None,
    raw_expires_at: str | None = None,
    raw_refresh_expires_at: str | None = None,
) -> list[str]:
    cleaned_access = (raw_access_token or "").strip()
    cleaned_refresh = (raw_refresh_token or "").strip()
    expires_at = parse_iso_datetime(raw_expires_at)
    refresh_expires_at = parse_iso_datetime(raw_refresh_expires_at)

    if not cleaned_access:
        for key in {
            GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY,
            GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY,
            GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
            GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
            GLOBAL_LINKEDIN_MEMBER_URN_KEY,
            GLOBAL_LINKEDIN_MEMBER_NAME_KEY,
            GLOBAL_LINKEDIN_SCOPES_KEY,
            GLOBAL_LINKEDIN_LAST_REFRESHED_KEY,
        }:
            set_app_setting_value(key, "", commit=False)
        set_app_setting_value(GLOBAL_LINKEDIN_LAST_CHECKED_KEY, utcnow().isoformat(), commit=False)
        accounts = SocialAccount.query.filter_by(platform="linkedin").all()
        for account in accounts:
            account.access_token = None
            account.refresh_token = None
            account.token_expires_at = None
            account.test_error = "Global LinkedIn token is not configured."
        db.session.commit()
        return []

    profile = fetch_linkedin_member_profile(cleaned_access)
    member_sub = str(profile.get("sub") or "").strip()
    member_urn = f"urn:li:person:{member_sub}" if member_sub else ""
    member_name = str(profile.get("name") or profile.get("given_name") or "").strip()
    scopes_raw = str(profile.get("scope") or profile.get("scopes") or "").strip()
    scopes = [scope for scope in scopes_raw.replace(",", " ").split() if scope]
    now = utcnow()

    set_app_setting_value(GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY, cleaned_access, commit=False)
    set_app_setting_value(GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY, cleaned_refresh, commit=False)
    update_global_linkedin_status_metadata(
        expires_at=expires_at,
        refresh_expires_at=refresh_expires_at,
        last_refreshed=now if cleaned_refresh else None,
        last_checked=now,
        member_urn=member_urn,
        member_name=member_name,
        scopes=scopes,
        commit=False,
    )
    db.session.commit()
    return propagate_global_linkedin_token()


def set_global_meta_user_token(raw_token: str | None) -> list[str]:
    cleaned = (raw_token or "").strip()
    if not cleaned:
        set_app_setting_value(GLOBAL_META_USER_TOKEN_KEY, "", commit=False)
        set_app_setting_value(LEGACY_META_GLOBAL_USER_TOKEN_KEY, "", commit=False)
        set_app_setting_value(META_GLOBAL_TOKEN_EXPIRES_AT_KEY, "", commit=False)
        set_app_setting_value(META_GLOBAL_EXPIRY_ASSUMED_KEY, "false", commit=False)
        set_app_setting_value(META_GLOBAL_LAST_REFRESHED_KEY, "", commit=False)
        set_app_setting_value(META_GLOBAL_LAST_CHECKED_KEY, utcnow().isoformat(), commit=True)
        return []

    probe = SocialAccount(page_id=0, platform="instagram", access_token=cleaned)
    normalize_meta_publish_token(probe, strict=True)
    if not probe.access_token:
        raise RuntimeError("Meta token exchange did not produce a usable access token.")

    now = utcnow()
    assumed_expiry = False
    effective_expiry = probe.token_expires_at
    if effective_expiry is None and probe.access_token and probe.access_token != cleaned:
        effective_expiry = (probe.last_refreshed or now) + timedelta(days=META_GLOBAL_ASSUMED_LIFETIME_DAYS)
        assumed_expiry = True
    set_app_setting_value(GLOBAL_META_USER_TOKEN_KEY, probe.access_token, commit=False)
    set_app_setting_value(LEGACY_META_GLOBAL_USER_TOKEN_KEY, "", commit=False)
    update_global_meta_status_metadata(
        expires_at=effective_expiry,
        last_refreshed=probe.last_refreshed or now,
        last_checked=now,
        expiry_assumed=assumed_expiry,
        commit=False,
    )
    db.session.commit()
    return propagate_global_meta_user_token()


def check_global_meta_token_health() -> None:
    shared_token = global_meta_user_token()
    if not shared_token:
        return
    current_status = global_meta_status()
    expires_at = meta_token_expiry_datetime(shared_token)
    if expires_at is None and current_status.get("expiry_assumed") and current_status.get("expires_at"):
        expires_at = parse_iso_datetime(current_status.get("expires_at"))
        update_global_meta_status_metadata(
            expires_at=expires_at,
            last_checked=utcnow(),
            expiry_assumed=True,
            commit=True,
        )
        return
    update_global_meta_status_metadata(
        expires_at=expires_at,
        last_checked=utcnow(),
        expiry_assumed=False,
        commit=True,
    )


def check_global_linkedin_token_health() -> None:
    if not global_linkedin_access_token():
        return
    update_global_linkedin_status_metadata(last_checked=utcnow(), commit=True)


def test_instagram_live(account: SocialAccount) -> str:
    payload = fetch_instagram_business_account(account.access_token, account.page_id_external)
    return payload.get("username") or payload.get("id") or "instagram-account"


def test_pinterest_live(account: SocialAccount) -> str:
    response = requests.get(
        "https://api.pinterest.com/v5/user_account",
        headers={"Authorization": f"Bearer {account.access_token}"},
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Pinterest")
    return payload.get("username") or payload.get("account_type") or "pinterest-account"


def refresh_facebook_token(account: SocialAccount) -> None:
    if global_meta_user_token():
        apply_global_meta_token_to_account(account)
        return
    if not account.access_token:
        raise RuntimeError("No Facebook token set for this account.")

    before = account.access_token
    normalize_meta_publish_token(account)
    if account.access_token == before:
        app_id, app_secret = meta_app_credentials()
        if not app_id or not app_secret:
            raise RuntimeError(
                "Set the Facebook App ID and App Secret in Global Settings to auto-exchange short-lived Meta tokens."
            )

    account.last_refreshed = utcnow()


def maybe_exchange_long_lived_meta_token(account: SocialAccount) -> None:
    if account.platform not in {"facebook", "instagram"}:
        return
    if not account.access_token:
        return

    try:
        normalize_meta_publish_token(account)
    except Exception as error:
        logger.info(
            "Skipped automatic long-lived token exchange for %s account_id=%s: %s",
            account.platform,
            account.id or "new",
            error,
        )


def require_meta_publish_token_normalization(account: SocialAccount) -> None:
    if account.platform not in {"facebook", "instagram"}:
        return
    if not account.access_token:
        return

    normalize_meta_publish_token(account, strict=True)


def linkedin_refresh_token_exchange(refresh_token: str) -> dict[str, Any]:
    client_id = os.environ.get("LINKEDIN_CLIENT_ID")
    client_secret = os.environ.get("LINKEDIN_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET for LinkedIn token refresh.")
    if not refresh_token:
        raise RuntimeError("No LinkedIn refresh_token is available.")

    response = requests.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "LinkedIn")


def refresh_linkedin_token(account: SocialAccount) -> None:
    payload = linkedin_refresh_token_exchange(account.refresh_token or "")
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("LinkedIn refresh did not return access_token.")

    account.access_token = token
    if payload.get("refresh_token"):
        account.refresh_token = payload["refresh_token"]
    expires_in = int(payload.get("expires_in", 5184000))
    account.token_expires_at = utcnow() + timedelta(seconds=max(expires_in - 86400, 3600))
    account.last_refreshed = utcnow()


def refresh_global_linkedin_token() -> list[str]:
    refresh_token = global_linkedin_refresh_token()
    if not refresh_token:
        raise RuntimeError("No global LinkedIn refresh token is configured.")

    payload = linkedin_refresh_token_exchange(refresh_token)
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("LinkedIn refresh did not return access_token.")

    if payload.get("refresh_token"):
        set_app_setting_value(GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY, payload["refresh_token"], commit=False)

    expires_in = payload.get("expires_in")
    refresh_expires_in = payload.get("refresh_token_expires_in")
    now = utcnow()
    expires_at = now + timedelta(seconds=max(int(expires_in) - 86400, 3600)) if expires_in else None
    refresh_expires_at = (
        now + timedelta(seconds=max(int(refresh_expires_in) - 86400, 3600))
        if refresh_expires_in
        else parse_iso_datetime(AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY))
    )

    set_app_setting_value(GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY, token, commit=False)
    update_global_linkedin_status_metadata(
        expires_at=expires_at,
        refresh_expires_at=refresh_expires_at,
        last_refreshed=now,
        last_checked=now,
        commit=False,
    )
    db.session.commit()
    return propagate_global_linkedin_token()


def refresh_pinterest_token(account: SocialAccount) -> None:
    app_id = os.environ.get("PINTEREST_APP_ID")
    app_secret = os.environ.get("PINTEREST_APP_SECRET")
    if not app_id or not app_secret:
        raise RuntimeError("Set PINTEREST_APP_ID and PINTEREST_APP_SECRET for Pinterest token refresh.")
    if not account.refresh_token:
        raise RuntimeError("No Pinterest refresh_token saved for this account.")

    response = requests.post(
        "https://api.pinterest.com/v5/oauth/token",
        data={"grant_type": "refresh_token", "refresh_token": account.refresh_token},
        auth=(app_id, app_secret),
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Pinterest")
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Pinterest refresh did not return access_token.")

    account.access_token = token
    if payload.get("refresh_token"):
        account.refresh_token = payload["refresh_token"]
    expires_in = int(payload.get("expires_in", 2592000))
    account.token_expires_at = utcnow() + timedelta(seconds=max(expires_in - 86400, 3600))
    account.last_refreshed = utcnow()


def refresh_platform_token(account: SocialAccount) -> None:
    if account.platform == "facebook":
        refresh_facebook_token(account)
        return
    if account.platform == "linkedin":
        if global_linkedin_access_token():
            refresh_global_linkedin_token()
            return
        refresh_linkedin_token(account)
        return
    if account.platform == "pinterest":
        refresh_pinterest_token(account)
        return

    raise RuntimeError(f"Token refresh not supported for {account.platform}.")

def env_present(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def account_publish_missing_fields(account: SocialAccount) -> list[str]:
    missing = missing_credential_fields(account)

    if account.platform == "instagram" and not account.page_id_external:
        if "page_id_external (Instagram business account ID)" not in missing:
            missing.append("page_id_external (Instagram business account ID)")

    return missing


def get_integration_check_payload(page_id: int | None = None) -> dict[str, Any]:
    public_base_url = os.environ.get("PUBLIC_BASE_URL", "").strip()
    live_enabled = should_use_live_posting(page_id)
    effective_settings = get_effective_settings(page_id)
    page_overrides = get_page_override_settings(page_id) if page_id is not None else {}
    selected_page = Page.query.get(page_id) if page_id is not None else None
    meta_status = global_meta_status()
    stored_meta_app_id = str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "").strip()
    stored_meta_app_secret = str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "").strip()
    resolved_meta_app_id, resolved_meta_app_secret = meta_app_credentials()

    platform_env = {
        "facebook": {
            "META_APP_ID (settings/env)": bool(resolved_meta_app_id),
            "META_APP_SECRET (settings/env)": bool(resolved_meta_app_secret),
            "Stored in Global Settings": bool(stored_meta_app_id and stored_meta_app_secret),
        },
        "linkedin": {
            "LINKEDIN_CLIENT_ID": env_present("LINKEDIN_CLIENT_ID"),
            "LINKEDIN_CLIENT_SECRET": env_present("LINKEDIN_CLIENT_SECRET"),
        },
        "pinterest": {
            "PINTEREST_APP_ID": env_present("PINTEREST_APP_ID"),
            "PINTEREST_APP_SECRET": env_present("PINTEREST_APP_SECRET"),
        },
        "twitter": {
            "requests_oauthlib_installed": OAuth1 is not None,
        },
        "general": {
            "APP_TIMEZONE": APP_TIMEZONE_NAME,
            "PUBLIC_BASE_URL": bool(public_base_url),
            "MEDIA_URL_SIGNING_SECRET": env_present("MEDIA_URL_SIGNING_SECRET"),
        },
    }

    account_rows = []
    accounts_query = SocialAccount.query.order_by(SocialAccount.created_at.desc())
    if page_id is not None:
        accounts_query = accounts_query.filter(SocialAccount.page_id == page_id)
    accounts = accounts_query.all()
    for account in accounts:
        missing = account_publish_missing_fields(account)
        account_rows.append(
            {
                "id": account.id,
                "page_id": account.page_id,
                "page_name": account.page.name if account.page else None,
                "platform": account.platform,
                "account_name": account.account_name,
                "active": bool(account.is_active),
                "ready_for_publish": len(missing) == 0 and account.is_active,
                "missing_fields": missing,
                "token_expires_at": account.token_expires_at.isoformat() if account.token_expires_at else None,
            }
        )

    media_delivery = {
        "public_base_url": public_base_url or None,
        "temporary_signed_urls_enabled": bool(public_base_url),
        "note": (
            "External platforms can fetch uploaded media through temporary signed URLs when PUBLIC_BASE_URL is set."
            if public_base_url
            else "Set PUBLIC_BASE_URL to generate temporary links for Instagram/Pinterest."
        ),
    }

    warnings: list[str] = []
    if live_enabled and not public_base_url:
        warnings.append("live_posting_enabled is true for this scope but PUBLIC_BASE_URL is not set.")
    if not resolved_meta_app_id or not resolved_meta_app_secret:
        warnings.append(
            "Facebook App ID / App Secret are not configured in Global Settings, so automatic Meta short-lived->long-lived token exchange is disabled."
        )
    if not meta_status["configured"]:
        warnings.append("Global Meta user token is not configured. Facebook/Instagram account automation is disabled.")
    elif meta_status["needs_refresh"]:
        warnings.append(
            f"Global Meta user token expires in {meta_status['days_until_expiry']} day(s). Replace it before it expires."
        )
    if OAuth1 is None:
        warnings.append("requests-oauthlib not installed; Twitter OAuth1 requests will fail.")

    return {
        "scope": {
            "type": "page" if page_id is not None else "global",
            "page_id": page_id,
            "page_name": selected_page.name if selected_page else None,
        },
        "live_posting_enabled": live_enabled,
        "effective_settings": effective_settings,
        "page_overrides": page_overrides,
        "platform_env": platform_env,
        "accounts": account_rows,
        "media_delivery": media_delivery,
        "meta_global": meta_status,
        "warnings": warnings,
    }
