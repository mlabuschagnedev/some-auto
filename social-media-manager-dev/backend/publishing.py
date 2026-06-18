from __future__ import annotations

from . import app as core
from .media import *
from .models import AppSetting, Page, PlanningRow, PlatformPostReference, Post, SocialAccount, db
from .settings import *

Any = core.Any
API_TIMEOUT_SECONDS = core.API_TIMEOUT_SECONDS
APP_TIMEZONE = core.APP_TIMEZONE
Callable = core.Callable
FACEBOOK_APP_ID_SETTING_KEY = core.FACEBOOK_APP_ID_SETTING_KEY
FACEBOOK_APP_SECRET_SETTING_KEY = core.FACEBOOK_APP_SECRET_SETTING_KEY
FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES = core.FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES
LINKEDIN_ALLOWED_ORG_POST_ROLES = core.LINKEDIN_ALLOWED_ORG_POST_ROLES
META_GLOBAL_ASSUMED_LIFETIME_DAYS = core.META_GLOBAL_ASSUMED_LIFETIME_DAYS
META_GLOBAL_EXPIRY_ASSUMED_KEY = core.META_GLOBAL_EXPIRY_ASSUMED_KEY
META_GLOBAL_LAST_CHECKED_KEY = core.META_GLOBAL_LAST_CHECKED_KEY
META_GLOBAL_LAST_REFRESHED_KEY = core.META_GLOBAL_LAST_REFRESHED_KEY
META_GLOBAL_TOKEN_EXPIRES_AT_KEY = core.META_GLOBAL_TOKEN_EXPIRES_AT_KEY
META_USER_TOKEN_CACHE = core.META_USER_TOKEN_CACHE
OAuth1 = core.OAuth1
PLANNING_FAILED_COLOR = core.PLANNING_FAILED_COLOR
PLANNING_POSTED_COLOR = core.PLANNING_POSTED_COLOR
PLANNING_READY_COLOR = core.PLANNING_READY_COLOR
PLANNING_SCHEDULED_COLOR = core.PLANNING_SCHEDULED_COLOR
Path = core.Path
StaleDataError = core.StaleDataError
app = core.app
cached_meta_user_token = lambda: core.META_USER_TOKEN_CACHE.get('meta')
datetime = core.datetime
has_app_context = core.has_app_context
joinedload = core.joinedload
json = core.json
local_datetime_to_unix_timestamp = core.local_datetime_to_unix_timestamp
logger = core.logger
mimetypes = core.mimetypes
os = core.os
parse_iso_datetime = core.parse_iso_datetime
quote = core.quote
requests = core.requests
time = core.time
timedelta = core.timedelta
utcnow = core.utcnow
uuid = core.uuid


def linkedin_api_headers(*args, **kwargs):
    from .integrations import linkedin_api_headers as impl

    return impl(*args, **kwargs)


def linkedin_api_request(*args, **kwargs):
    from .integrations import linkedin_api_request as impl

    return impl(*args, **kwargs)


def normalize_linkedin_organization_urn(*args, **kwargs):
    from .integrations import normalize_linkedin_organization_urn as impl

    return impl(*args, **kwargs)


def validate_linkedin_account_binding(*args, **kwargs):
    from .integrations import validate_linkedin_account_binding as impl

    return impl(*args, **kwargs)


def clear_planning_warning_state(*args, **kwargs):
    from .planning import clear_planning_warning_state as impl

    return impl(*args, **kwargs)


def parse_planning_schedule_datetime(*args, **kwargs):
    from .planning import parse_planning_schedule_datetime as impl

    return impl(*args, **kwargs)

def extract_response_error(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:500]

    if isinstance(payload, dict):
        if "error" in payload:
            return json.dumps(payload["error"])
        if "errors" in payload:
            return json.dumps(payload["errors"])
        return json.dumps(payload)

    return str(payload)


def parse_error_json_from_message(message: str) -> dict[str, Any]:
    if not message:
        return {}

    start = message.find("{")
    if start < 0:
        return {}

    try:
        payload = json.loads(message[start:])
    except Exception:
        return {}

    if isinstance(payload, dict):
        return payload
    return {}


def is_transient_instagram_error(error: Exception | str) -> bool:
    message = str(error)
    if not message or "Instagram API error" not in message:
        return False

    payload = parse_error_json_from_message(message)
    return bool(payload.get("is_transient")) or str(payload.get("code") or "") == "2"


def run_instagram_transient_retry(
    action_label: str,
    action: Callable[[], Any],
    *,
    attempts: int = 3,
    initial_delay_seconds: int = 5,
) -> Any:
    delay_seconds = max(initial_delay_seconds, 1)
    last_error: Exception | None = None

    for attempt in range(1, max(attempts, 1) + 1):
        try:
            return action()
        except Exception as error:
            last_error = error
            if attempt >= attempts or not is_transient_instagram_error(error):
                raise
            logger.warning(
                "Instagram transient failure during %s (attempt %s/%s): %s. Retrying in %ss.",
                action_label,
                attempt,
                attempts,
                error,
                delay_seconds,
            )
            time.sleep(delay_seconds)
            delay_seconds *= 2

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Instagram action failed unexpectedly: {action_label}")


def ensure_success(response: requests.Response, platform: str) -> dict[str, Any]:
    if not response.ok:
        raise RuntimeError(f"{platform} API error ({response.status_code}): {extract_response_error(response)}")

    if response.content:
        try:
            return response.json()
        except ValueError:
            return {}
    return {}


def meta_app_credentials() -> tuple[str | None, str | None]:
    stored_app_id = None
    stored_app_secret = None
    if has_app_context():
        stored_app_id = str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "").strip() or None
        stored_app_secret = str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "").strip() or None

    env_app_id = os.environ.get("FACEBOOK_APP_ID", "").strip() or None
    env_app_secret = os.environ.get("FACEBOOK_APP_SECRET", "").strip() or None
    return stored_app_id or env_app_id, stored_app_secret or env_app_secret


def cache_meta_user_token(seed_token: str, access_token: str, expires_at: datetime | None = None) -> None:
    if not seed_token or not access_token:
        return

    cache_entry = {"access_token": access_token, "expires_at": expires_at}
    META_USER_TOKEN_CACHE[seed_token] = cache_entry
    META_USER_TOKEN_CACHE[access_token] = cache_entry


def cached_meta_user_token(seed_token: str) -> tuple[str | None, datetime | None]:
    cached = META_USER_TOKEN_CACHE.get(seed_token)
    if not cached:
        return None, None
    return cached.get("access_token"), cached.get("expires_at")


def inspect_meta_token(access_token: str) -> dict[str, Any]:
    app_id, app_secret = meta_app_credentials()
    if not app_id or not app_secret:
        return {}

    response = requests.get(
        "https://graph.facebook.com/debug_token",
        params={
            "input_token": access_token,
            "access_token": f"{app_id}|{app_secret}",
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    data = payload.get("data")
    return data if isinstance(data, dict) else {}


def meta_token_expiry_datetime(access_token: str) -> datetime | None:
    token_data = inspect_meta_token(access_token)
    expires_at = token_data.get("expires_at")
    if expires_at in (None, 0, "0"):
        return None

    try:
        expires_at_ts = int(expires_at)
    except (TypeError, ValueError):
        return None

    if expires_at_ts <= 0:
        return None

    return datetime.fromtimestamp(expires_at_ts, tz=APP_TIMEZONE).replace(tzinfo=None)


def update_global_meta_status_metadata(
    *,
    expires_at: datetime | None = None,
    last_refreshed: datetime | None = None,
    last_checked: datetime | None = None,
    expiry_assumed: bool | None = None,
    commit: bool = False,
) -> None:
    set_app_setting_value(
        META_GLOBAL_TOKEN_EXPIRES_AT_KEY,
        expires_at.isoformat() if expires_at is not None else "",
        commit=False,
    )
    if last_refreshed is not None:
        set_app_setting_value(META_GLOBAL_LAST_REFRESHED_KEY, last_refreshed.isoformat(), commit=False)
    if last_checked is not None:
        set_app_setting_value(META_GLOBAL_LAST_CHECKED_KEY, last_checked.isoformat(), commit=False)
    if expiry_assumed is not None:
        set_app_setting_value(META_GLOBAL_EXPIRY_ASSUMED_KEY, "true" if expiry_assumed else "false", commit=False)
    if commit:
        db.session.commit()


def exchange_long_lived_meta_user_token(access_token: str) -> tuple[str, int | None]:
    app_id, app_secret = meta_app_credentials()
    if not app_id or not app_secret:
        raise RuntimeError(
            "Set the Facebook App ID and App Secret in Global Settings before automatic Meta token exchange can run."
        )

    response = requests.get(
        "https://graph.facebook.com/v25.0/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": access_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Facebook token exchange did not return access_token.")
    expires_in = payload.get("expires_in")
    return token, int(expires_in) if expires_in is not None else None


def resolve_facebook_page_access_token(seed_token: str, page_id: str) -> tuple[str, str | None]:
    response = requests.get(
        f"https://graph.facebook.com/v25.0/{page_id}",
        params={
            "fields": "id,name,access_token",
            "access_token": seed_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    page_token = payload.get("access_token")
    if not page_token:
        raise RuntimeError("Could not derive Page access token from supplied token.")
    return page_token, payload.get("name")


def normalize_meta_publish_token(account: SocialAccount, strict: bool = False) -> None:
    if account.platform not in {"facebook", "instagram"}:
        return
    if not account.access_token:
        return

    original_token = account.access_token
    token = original_token
    exchanged = False
    exchanged_user_token: str | None = None
    exchange_expires_in: int | None = None
    cached_expiry: datetime | None = None
    supplied_token_data: dict[str, Any] = {}
    supplied_token_type = ""
    token_already_usable = False
    skip_page_token_resolution = False

    cached_user_token, cached_expiry = cached_meta_user_token(original_token)
    if cached_user_token:
        token = cached_user_token
        exchanged = True
        exchanged_user_token = cached_user_token

    # First try to convert short-lived user token to long-lived user token (if app creds are present).
    if not cached_user_token:
        try:
            token, exchange_expires_in = exchange_long_lived_meta_user_token(token)
            exchanged = True
            exchanged_user_token = token
        except Exception as error:
            supplied_token_data = inspect_meta_token(original_token)
            supplied_token_type = str(supplied_token_data.get("type") or "").upper()
            token_already_usable = bool(supplied_token_data.get("is_valid")) and (
                (account.platform == "instagram" and supplied_token_type == "USER")
                or (account.platform == "facebook" and supplied_token_type in {"USER", "PAGE"})
            )
            if token_already_usable:
                token = original_token
                if supplied_token_type == "USER":
                    exchanged = True
                    exchanged_user_token = token
                    cached_expiry = meta_token_expiry_datetime(token)
                    cache_meta_user_token(original_token, token, cached_expiry)
                else:
                    skip_page_token_resolution = True
            elif strict:
                raise RuntimeError(f"Meta token exchange failed: {error}") from error
            else:
                logger.info(
                    "Meta token exchange skipped for %s account_id=%s: %s",
                    account.platform,
                    account.id or "new",
                    error,
                )
        else:
            cache_meta_user_token(original_token, token)

    # For Facebook posting, always prefer a Page access token for the configured page.
    if account.platform == "facebook" and account.page_id_external and not skip_page_token_resolution:
        try:
            page_token, page_name = resolve_facebook_page_access_token(token, account.page_id_external)
            token = page_token
            if page_name:
                account.account_name = account.account_name or page_name
        except Exception as error:
            if strict:
                raise RuntimeError(f"Facebook page token resolve failed: {error}") from error
            logger.info(
                "Facebook page token resolve skipped for account_id=%s page_id=%s: %s",
                account.id or "new",
                account.page_id_external,
                error,
            )

    account.access_token = token
    if token != original_token or token_already_usable:
        account.last_refreshed = utcnow()
    if exchanged:
        if exchange_expires_in:
            account.token_expires_at = utcnow() + timedelta(seconds=max(exchange_expires_in - 86400, 3600))
        else:
            account.token_expires_at = cached_expiry or meta_token_expiry_datetime(exchanged_user_token or token)
        if exchanged_user_token:
            cache_meta_user_token(original_token, exchanged_user_token, account.token_expires_at)


def should_use_live_posting(page_id: int | None = None) -> bool:
    value = get_effective_settings(page_id).get("live_posting_enabled", "false")
    return str(value).lower() == "true"


def get_active_page_account(page: Page, platform: str) -> SocialAccount | None:
    for account in page.social_accounts:
        if account.platform == platform and account.is_active:
            return account
    return None


def facebook_native_schedule_deadline(now: datetime | None = None) -> datetime:
    base = now or utcnow()
    return base + timedelta(minutes=FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES)


def page_requires_facebook_native_scheduling(page: Page) -> bool:
    return bool(page and should_use_live_posting(page.id) and get_active_page_account(page, "facebook"))


def simulate_platform_post(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    fake_id = f"{account.platform}_{uuid.uuid4().hex[:18]}"
    logger.info(
        "Simulated post => platform=%s account_id=%s post_id=%s media=%s",
        account.platform,
        account.id,
        post.id,
        len(media_paths),
    )
    return {
        "success": True,
        "platform": account.platform,
        "post_id": fake_id,
        "post_url": None,
        "simulated": True,
    }


def scheduled_facebook_remote_result(post: Post) -> dict[str, Any]:
    post_id = post.facebook_post_id or post.facebook_remote_post_id
    return {
        "success": True,
        "platform": "facebook",
        "post_id": post_id,
        "post_url": post.platform_url_map().get("facebook"),
        "handed_off": True,
        "skip_apply_platform_result": True,
        "message": "Facebook post was scheduled natively on Meta and will not be published again locally.",
    }


def fetch_instagram_permalink(account: SocialAccount, media_id: str | None) -> str | None:
    if not media_id or not account.access_token:
        return None

    response = requests.get(
        f"https://graph.facebook.com/v25.0/{media_id}",
        params={"fields": "permalink", "access_token": account.access_token},
        timeout=API_TIMEOUT_SECONDS,
    )
    try:
        payload = ensure_success(response, "Instagram")
    except Exception as error:
        logger.info("Instagram permalink lookup failed for media_id=%s: %s", media_id, error)
        return None
    permalink = payload.get("permalink")
    return str(permalink).strip() if permalink else None


def upload_facebook_attached_media(
    account: SocialAccount,
    target_id: str,
    media_file_path: str,
) -> str:
    media_path = Path(media_file_path)
    if not media_path.exists():
        raise RuntimeError(f"Media file not found: {media_path}")

    if is_video_path(str(media_path)):
        endpoint = f"https://graph.facebook.com/v25.0/{target_id}/videos"
        data = {"published": "false", "access_token": account.access_token}
    else:
        endpoint = f"https://graph.facebook.com/v25.0/{target_id}/photos"
        data = {"published": "false", "access_token": account.access_token}

    with media_path.open("rb") as media_file:
        response = requests.post(
            endpoint,
            data=data,
            files={"source": media_file},
            timeout=API_TIMEOUT_SECONDS,
        )
    payload = ensure_success(response, "Facebook")
    media_id = payload.get("id")
    if not media_id:
        raise RuntimeError("Facebook attached media upload returned no id.")
    return str(media_id)


def facebook_attached_media_fields(media_ids: list[str]) -> dict[str, str]:
    return {
        f"attached_media[{index}]": json.dumps({"media_fbid": media_id})
        for index, media_id in enumerate(media_ids)
    }


def record_facebook_remote_schedule(post: Post, remote_post_id: str) -> None:
    post.facebook_remote_post_id = remote_post_id
    post.facebook_remote_state = "scheduled"
    post.facebook_remote_scheduled_time = post.scheduled_time
    post.facebook_remote_last_error = None
    post.facebook_remote_synced_at = utcnow()


def clear_facebook_remote_schedule(post: Post) -> None:
    post.facebook_remote_post_id = None
    post.facebook_remote_state = None
    post.facebook_remote_scheduled_time = None
    post.facebook_remote_last_error = None
    post.facebook_remote_synced_at = utcnow()


def schedule_facebook_feed_post(
    account: SocialAccount,
    target_id: str,
    content: str,
    *,
    scheduled_time: datetime,
    attached_media_ids: list[str] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "message": content,
        "access_token": account.access_token,
        "published": "false",
        "unpublished_content_type": "SCHEDULED",
        "scheduled_publish_time": str(local_datetime_to_unix_timestamp(scheduled_time)),
    }
    if attached_media_ids:
        payload.update(facebook_attached_media_fields(attached_media_ids))

    response = requests.post(
        f"https://graph.facebook.com/v25.0/{target_id}/feed",
        data=payload,
        timeout=API_TIMEOUT_SECONDS,
    )
    response_payload = ensure_success(response, "Facebook")
    post_id = response_payload.get("id")
    if not post_id:
        raise RuntimeError("Facebook scheduled feed post returned no id.")
    return str(post_id)


def schedule_facebook_video_post(
    account: SocialAccount,
    target_id: str,
    media_file_path: str,
    *,
    content: str,
    scheduled_time: datetime,
) -> str:
    media_path = Path(media_file_path)
    if not media_path.exists():
        raise RuntimeError(f"Media file not found: {media_path}")

    with media_path.open("rb") as media_file:
        response = requests.post(
            f"https://graph.facebook.com/v25.0/{target_id}/videos",
            data={
                "description": content,
                "published": "false",
                "scheduled_publish_time": str(local_datetime_to_unix_timestamp(scheduled_time)),
                "access_token": account.access_token,
            },
            files={"source": media_file},
            timeout=API_TIMEOUT_SECONDS,
        )
    response_payload = ensure_success(response, "Facebook")
    post_id = response_payload.get("id")
    if not post_id:
        raise RuntimeError("Facebook scheduled video upload returned no id.")
    return str(post_id)


def schedule_facebook_remote_post(account: SocialAccount, post: Post, media_paths: list[str]) -> str:
    if not account.access_token:
        raise RuntimeError("Missing Facebook access_token")
    if not account.page_id_external:
        raise RuntimeError("Facebook page_id_external is required for native scheduling.")
    if not post.scheduled_time:
        raise RuntimeError("Facebook native scheduling requires a scheduled_time.")

    target_id = account.page_id_external
    content = post.content or ""
    resolved_media = normalize_media_for_publishing([str(Path(path)) for path in media_paths])
    video_count = sum(1 for item in resolved_media if is_video_path(item))

    if video_count > 1:
        raise RuntimeError("Facebook native scheduling supports only one video per post.")
    if video_count and len(resolved_media) > 1:
        raise RuntimeError("Facebook native scheduling does not support mixing a video with other media in this build.")

    if not resolved_media:
        return schedule_facebook_feed_post(account, target_id, content, scheduled_time=post.scheduled_time)

    if video_count == 1:
        return schedule_facebook_video_post(
            account,
            target_id,
            resolved_media[0],
            content=content,
            scheduled_time=post.scheduled_time,
        )

    attached_media_ids = [upload_facebook_attached_media(account, target_id, media) for media in resolved_media]
    return schedule_facebook_feed_post(
        account,
        target_id,
        content,
        scheduled_time=post.scheduled_time,
        attached_media_ids=attached_media_ids,
    )


def delete_facebook_remote_post(account: SocialAccount, remote_post_id: str) -> None:
    response = requests.delete(
        f"https://graph.facebook.com/v25.0/{remote_post_id}",
        data={"access_token": account.access_token},
        timeout=API_TIMEOUT_SECONDS,
    )
    if response.ok:
        return

    error_text = extract_response_error(response)
    if '"code": 100' in error_text or '"error_subcode": 33' in error_text or "does not exist" in error_text.lower():
        logger.info("Facebook remote post %s was already unavailable during delete.", remote_post_id)
        return
    raise RuntimeError(f"Facebook API error ({response.status_code}): {error_text}")


def fetch_facebook_remote_post_state(account: SocialAccount, remote_post_id: str) -> dict[str, Any]:
    response = requests.get(
        f"https://graph.facebook.com/v25.0/{remote_post_id}",
        params={
            "fields": "id,is_published,scheduled_publish_time,permalink_url,status_type,created_time",
            "access_token": account.access_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "Facebook")


def update_facebook_remote_post_record(post: Post, payload: dict[str, Any]) -> None:
    post.facebook_remote_synced_at = utcnow()
    post.facebook_remote_last_error = None

    scheduled_raw = payload.get("scheduled_publish_time")
    if scheduled_raw is not None:
        try:
            post.facebook_remote_scheduled_time = datetime.fromtimestamp(int(scheduled_raw), tz=APP_TIMEZONE).replace(tzinfo=None)
        except (TypeError, ValueError, OSError):
            parsed = parse_iso_datetime(str(scheduled_raw))
            if parsed is not None:
                post.facebook_remote_scheduled_time = parsed

    if payload.get("is_published"):
        post.facebook_remote_state = "published"
        post.facebook_post_id = post.facebook_post_id or post.facebook_remote_post_id
        apply_platform_result(post, "facebook", post.facebook_post_id, payload.get("permalink_url"))
    else:
        post.facebook_remote_state = "scheduled"


def cancel_pending_facebook_remote_schedule(post: Post) -> None:
    if not post.facebook_remote_post_id or post.facebook_remote_state == "published":
        return

    page = post.page or Page.query.options(joinedload(Page.social_accounts)).get(post.page_id)
    if not page:
        raise RuntimeError("Cannot cancel Facebook scheduled post because the page no longer exists.")
    account = get_active_page_account(page, "facebook")
    if not account:
        raise RuntimeError("Cannot cancel Facebook scheduled post because no active Facebook account is connected.")

    delete_facebook_remote_post(account, post.facebook_remote_post_id)
    clear_facebook_remote_schedule(post)


def sync_facebook_remote_posts() -> None:
    posts = (
        Post.query.options(joinedload(Post.page).joinedload(Page.social_accounts))
        .filter(Post.facebook_remote_post_id.isnot(None))
        .all()
    )
    changed = False

    for post in posts:
        if not post.page or post.facebook_remote_state == "published":
            continue

        account = get_active_page_account(post.page, "facebook")
        if not account or not account.access_token:
            continue

        try:
            payload = fetch_facebook_remote_post_state(account, post.facebook_remote_post_id)
        except Exception as error:
            post.facebook_remote_state = "sync_error"
            post.facebook_remote_last_error = str(error)
            post.facebook_remote_synced_at = utcnow()
            changed = True
            continue

        update_facebook_remote_post_record(post, payload)
        changed = True

    if changed:
        db.session.commit()


def handoff_pending_facebook_remote_posts(now: datetime | None = None) -> None:
    current_time = now or utcnow()
    deadline = facebook_native_schedule_deadline(current_time)
    posts = (
        Post.query.options(joinedload(Post.page).joinedload(Page.social_accounts))
        .filter(Post.status == "scheduled")
        .filter(Post.facebook_remote_post_id.is_(None))
        .filter(Post.scheduled_time.isnot(None))
        .all()
    )
    changed = False

    for post in posts:
        if not post.page:
            continue
        if "facebook" not in post.platform_list():
            continue
        if not should_use_live_posting(post.page.id):
            continue

        account = get_active_page_account(post.page, "facebook")
        if not account or not account.access_token:
            continue

        if post.scheduled_time and post.scheduled_time < deadline:
            error_message = (
                "Facebook native scheduling requires at least "
                f"{FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES} minutes of lead time. "
                "Reschedule this post."
            )
            if post.facebook_remote_state != "sync_error" or post.facebook_remote_last_error != error_message:
                post.facebook_remote_state = "sync_error"
                post.facebook_remote_last_error = error_message
                post.facebook_remote_synced_at = utcnow()
                changed = True
            continue

        try:
            resolved_media = [str(resolve_upload_path(item)) for item in post.media_list()]
            remote_post_id = schedule_facebook_remote_post(account, post, resolved_media)
        except Exception as error:
            post.facebook_remote_state = "sync_error"
            post.facebook_remote_last_error = str(error)
            post.facebook_remote_synced_at = utcnow()
            changed = True
            logger.warning("Facebook remote handoff failed for scheduled post %s: %s", post.id, error)
            continue

        record_facebook_remote_schedule(post, remote_post_id)
        changed = True
        logger.info("Handed scheduled post %s off to Meta as Facebook remote post %s.", post.id, remote_post_id)

    if changed:
        db.session.commit()


def publish_facebook_feed_post(
    account: SocialAccount,
    target_id: str,
    message: str,
    attached_media_ids: list[str] | None = None,
) -> dict[str, Any]:
    data = {
        "message": message,
        "published": "true",
        "access_token": account.access_token,
    }
    if attached_media_ids:
        data.update(facebook_attached_media_fields(attached_media_ids))

    response = requests.post(
        f"https://graph.facebook.com/v25.0/{target_id}/feed",
        data=data,
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Facebook")
    post_id = payload.get("id")
    return {
        "success": True,
        "platform": "facebook",
        "post_id": post_id,
        "post_url": build_platform_post_url(account, "facebook", post_id),
    }


def instagram_container_status(account: SocialAccount, container_id: str) -> str | None:
    def action() -> dict[str, Any]:
        response = requests.get(
            f"https://graph.facebook.com/v25.0/{container_id}",
            params={"fields": "status_code,status", "access_token": account.access_token},
            timeout=API_TIMEOUT_SECONDS,
        )
        return ensure_success(response, "Instagram")

    payload = run_instagram_transient_retry(f"container status {container_id}", action)
    status = payload.get("status_code") or payload.get("status")
    return str(status).strip().upper() if status else None


def wait_for_instagram_container(account: SocialAccount, container_id: str, timeout_seconds: int = 300) -> None:
    deadline = time.time() + timeout_seconds
    last_status = None
    while time.time() < deadline:
        status = instagram_container_status(account, container_id)
        if status != last_status:
            logger.info(
                "Instagram container %s status=%s for account_id=%s",
                container_id,
                status or "unknown",
                account.id,
            )
        if not status or status in {"FINISHED", "PUBLISHED"}:
            return
        if status in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Instagram media container {container_id} failed with status {status}.")
        last_status = status
        time.sleep(5)
    raise RuntimeError(
        f"Instagram media container {container_id} did not finish processing in time"
        f"{f' (last status: {last_status})' if last_status else ''}."
    )


def create_instagram_media_container(
    account: SocialAccount,
    ig_user_id: str,
    *,
    media_url: str | None = None,
    is_video: bool = False,
    caption: str | None = None,
    is_carousel_item: bool = False,
    children: list[str] | None = None,
) -> str:
    payload: dict[str, Any] = {"access_token": account.access_token}
    if children is not None:
        payload["media_type"] = "CAROUSEL"
        payload["children"] = ",".join(children)
        payload["caption"] = caption or ""
    else:
        if is_carousel_item:
            payload["is_carousel_item"] = "true"
        elif caption is not None:
            payload["caption"] = caption

        if is_video:
            payload["media_type"] = "VIDEO" if is_carousel_item else "REELS"
            payload["video_url"] = media_url
        else:
            payload["image_url"] = media_url

    def action() -> dict[str, Any]:
        response = requests.post(
            f"https://graph.facebook.com/v25.0/{ig_user_id}/media",
            data=payload,
            timeout=API_TIMEOUT_SECONDS,
        )
        return ensure_success(response, "Instagram")

    payload = run_instagram_transient_retry("media container create", action)
    creation_id = payload.get("id")
    if not creation_id:
        raise RuntimeError("Instagram did not return a creation ID.")
    return str(creation_id)


def build_platform_post_url(account: SocialAccount, platform: str, post_id: str | None) -> str | None:
    if not post_id:
        return None

    clean_id = str(post_id).strip()
    if not clean_id:
        return None

    if platform == "facebook":
        if "_" in clean_id:
            owner_id, post_part = clean_id.split("_", 1)
            owner_value = account.page_id_external or owner_id
            if owner_value and post_part:
                return f"https://www.facebook.com/{quote(owner_value, safe='')}/posts/{quote(post_part, safe='')}"
        return f"https://www.facebook.com/{quote(clean_id, safe='')}"

    if platform == "twitter":
        return f"https://x.com/i/web/status/{quote(clean_id, safe='')}"

    if platform == "linkedin":
        update_ref = clean_id if clean_id.startswith("urn:") else f"urn:li:ugcPost:{clean_id}"
        return f"https://www.linkedin.com/feed/update/{quote(update_ref, safe='')}/"

    if platform == "pinterest":
        return f"https://www.pinterest.com/pin/{quote(clean_id, safe='')}/"

    return None


def build_local_media_url(media_path: str) -> str:
    if str(media_path).startswith(("http://", "https://")):
        return str(media_path)
    relative = str(Path(media_path)).replace("\\", "/")
    return f"/uploads/{quote(relative, safe='/')}"


def build_post_platform_urls(post: Post) -> dict[str, str]:
    url_map = post.platform_url_map()
    if not post.page:
        return url_map

    accounts_by_platform: dict[str, SocialAccount] = {}
    for account in post.page.social_accounts:
        if account.platform not in accounts_by_platform:
            accounts_by_platform[account.platform] = account

    for platform, post_id in {
        "facebook": post.facebook_post_id,
        "instagram": post.instagram_post_id,
        "linkedin": post.linkedin_post_id,
        "twitter": post.twitter_post_id,
        "pinterest": post.pinterest_post_id,
    }.items():
        if url_map.get(platform) or not post_id:
            continue
        account = accounts_by_platform.get(platform)
        if not account:
            continue
        derived = build_platform_post_url(account, platform, post_id)
        if derived:
            url_map[platform] = derived

    return url_map


def post_requires_manual_linkedin(post: Post) -> bool:
    return "linkedin" in post.platform_list()


def automated_platforms_for_post(post: Post) -> list[str]:
    return [platform for platform in post.platform_list() if platform != "linkedin"]


def twitter_oauth1(account: SocialAccount) -> OAuth1:
    if OAuth1 is None:
        raise RuntimeError("requests-oauthlib is not installed. Install backend requirements first.")

    required = {
        "api_key": account.api_key,
        "api_secret": account.api_secret,
        "access_token": account.access_token,
        "access_token_secret": account.access_token_secret,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing Twitter credentials: {', '.join(missing)}")

    return OAuth1(
        client_key=account.api_key,
        client_secret=account.api_secret,
        resource_owner_key=account.access_token,
        resource_owner_secret=account.access_token_secret,
    )


def post_to_facebook_live(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    if not account.access_token:
        raise RuntimeError("Missing Facebook access_token")

    target_id = account.page_id_external or "me"
    if target_id == "me":
        raise RuntimeError("Facebook page_id_external is required for page publishing.")
    base_url = "https://graph.facebook.com/v25.0"
    content = post.content or ""

    if not media_paths:
        return publish_facebook_feed_post(account, target_id, content)

    if len(media_paths) == 1:
        media_path = Path(media_paths[0])
        if not media_path.exists():
            raise RuntimeError(f"Media file not found: {media_path}")

        if is_video_path(str(media_path)):
            with media_path.open("rb") as media_file:
                response = requests.post(
                    f"{base_url}/{target_id}/videos",
                    data={"description": content, "access_token": account.access_token},
                    files={"source": media_file},
                    timeout=API_TIMEOUT_SECONDS,
                )
            payload = ensure_success(response, "Facebook")
            post_id = payload.get("id")
            return {"success": True, "platform": "facebook", "post_id": post_id, "post_url": build_platform_post_url(account, "facebook", post_id)}

        photo_id = upload_facebook_attached_media(account, target_id, str(media_path))
        return publish_facebook_feed_post(account, target_id, content, [photo_id])

    if any(is_video_path(media) for media in media_paths):
        raise RuntimeError(
            "Facebook feed attachment publishing supports photo sets only. "
            "Use a single video post or remove videos from the multi-media Facebook post."
        )

    attached_photo_ids = [
        upload_facebook_attached_media(account, target_id, media)
        for media in media_paths
    ]
    return publish_facebook_feed_post(account, target_id, content, attached_photo_ids)


def twitter_upload_media(oauth: OAuth1, media_file_path: str) -> str:
    media_path = Path(media_file_path)
    if not media_path.exists():
        raise RuntimeError(f"Media file not found: {media_path}")

    mime_type, _ = mimetypes.guess_type(str(media_path))
    mime_type = mime_type or ("video/mp4" if is_video_path(str(media_path)) else "image/jpeg")

    if not is_video_path(str(media_path)):
        with media_path.open("rb") as media_file:
            upload_response = requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                files={"media": media_file},
                auth=oauth,
                timeout=API_TIMEOUT_SECONDS,
            )
        payload = ensure_success(upload_response, "Twitter")
        media_id = payload.get("media_id_string")
        if not media_id:
            raise RuntimeError("Twitter image upload returned no media_id_string.")
        return media_id

    total_bytes = media_path.stat().st_size
    init_response = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        data={
            "command": "INIT",
            "total_bytes": total_bytes,
            "media_type": mime_type,
            "media_category": "tweet_video",
        },
        auth=oauth,
        timeout=API_TIMEOUT_SECONDS,
    )
    init_payload = ensure_success(init_response, "Twitter")
    media_id = init_payload.get("media_id_string")
    if not media_id:
        raise RuntimeError("Twitter INIT upload returned no media_id_string.")

    chunk_size = 4 * 1024 * 1024
    with media_path.open("rb") as media_file:
        segment_index = 0
        while True:
            chunk = media_file.read(chunk_size)
            if not chunk:
                break
            append_response = requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                data={
                    "command": "APPEND",
                    "media_id": media_id,
                    "segment_index": segment_index,
                },
                files={"media": ("chunk", chunk)},
                auth=oauth,
                timeout=API_TIMEOUT_SECONDS,
            )
            if not append_response.ok:
                raise RuntimeError(
                    f"Twitter APPEND failed ({append_response.status_code}): {extract_response_error(append_response)}"
                )
            segment_index += 1

    finalize_response = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        data={"command": "FINALIZE", "media_id": media_id},
        auth=oauth,
        timeout=API_TIMEOUT_SECONDS,
    )
    finalize_payload = ensure_success(finalize_response, "Twitter")

    processing = finalize_payload.get("processing_info")
    attempts = 0
    while processing and processing.get("state") in {"pending", "in_progress"} and attempts < 20:
        wait_seconds = int(processing.get("check_after_secs", 5))
        time.sleep(max(wait_seconds, 1))
        status_response = requests.get(
            "https://upload.twitter.com/1.1/media/upload.json",
            params={"command": "STATUS", "media_id": media_id},
            auth=oauth,
            timeout=API_TIMEOUT_SECONDS,
        )
        status_payload = ensure_success(status_response, "Twitter")
        processing = status_payload.get("processing_info")
        attempts += 1

    if processing and processing.get("state") == "failed":
        error = processing.get("error", {})
        raise RuntimeError(f"Twitter video processing failed: {error}")

    if processing and processing.get("state") in {"pending", "in_progress"}:
        raise RuntimeError("Twitter video processing timed out.")

    return media_id


def post_to_twitter_live(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    oauth = twitter_oauth1(account)
    media_ids: list[str] = []

    for media in media_paths[:4]:
        media_ids.append(twitter_upload_media(oauth, media))

    tweet_payload: dict[str, Any] = {"text": post.content or ""}
    if media_ids:
        tweet_payload["media"] = {"media_ids": media_ids}

    response = requests.post(
        "https://api.twitter.com/2/tweets",
        json=tweet_payload,
        auth=oauth,
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Twitter")
    post_id = payload.get("data", {}).get("id")
    return {"success": True, "platform": "twitter", "post_id": post_id, "post_url": build_platform_post_url(account, "twitter", post_id)}


def resolve_linkedin_author_urn(account: SocialAccount) -> str:
    organization_urn = normalize_linkedin_organization_urn(account.page_id_external)
    if not organization_urn:
        raise RuntimeError("LinkedIn page_id_external must be set to the organization ID or organization URN.")
    return organization_urn


def linkedin_asset_id_from_urn(asset_urn: str) -> str:
    return str(asset_urn or "").rsplit(":", 1)[-1]


def linkedin_upload_binary(upload_url: str, media_path: Path, mime_type: str) -> None:
    with media_path.open("rb") as media_file:
        upload_response = requests.put(
            upload_url,
            data=media_file,
            headers={"Content-Type": mime_type},
            timeout=API_TIMEOUT_SECONDS,
        )
    if upload_response.status_code not in {200, 201, 202}:
        raise RuntimeError(
            f"LinkedIn media upload failed ({upload_response.status_code}): {upload_response.text[:500]}"
        )


def wait_for_linkedin_media_asset(
    account: SocialAccount,
    asset_urn: str,
    asset_kind: str,
    timeout_seconds: int = 300,
) -> None:
    asset_id = linkedin_asset_id_from_urn(asset_urn)
    deadline = time.time() + timeout_seconds
    last_status = None

    while time.time() < deadline:
        payload = linkedin_api_request("GET", f"/rest/{asset_kind}/{asset_id}", account.access_token or "")
        status_payload = payload.get("status")
        status = ""
        if isinstance(status_payload, dict):
            for key in ("status", "state", "recipeStatus", "uploadStatus"):
                value = status_payload.get(key)
                if value:
                    status = str(value).strip().upper()
                    break
        if not status:
            for key in ("status", "lifecycleState", "processingStatus"):
                value = payload.get(key)
                if value:
                    status = str(value).strip().upper()
                    break

        if status != last_status:
            logger.info("LinkedIn %s %s status=%s", asset_kind, asset_urn, status or "unknown")
        if not status or status in {"AVAILABLE", "READY", "PUBLISHED"}:
            return
        if status in {"FAILED", "PROCESSING_FAILED", "ERROR"}:
            raise RuntimeError(f"LinkedIn {asset_kind} asset {asset_urn} failed with status {status}.")
        last_status = status
        time.sleep(5)

    raise RuntimeError(f"LinkedIn {asset_kind} asset {asset_urn} did not become ready in time.")


def linkedin_register_upload(
    account: SocialAccount,
    author_urn: str,
    media_file_path: str,
) -> tuple[str, str]:
    media_path = Path(media_file_path)
    if not media_path.exists():
        raise RuntimeError(f"Media file not found: {media_path}")

    if not account.access_token:
        raise RuntimeError("Missing LinkedIn access_token")

    is_video = is_video_path(str(media_path))
    media_category = "VIDEO" if is_video else "IMAGE"
    mime_type, _ = mimetypes.guess_type(str(media_path))
    mime_type = mime_type or ("video/mp4" if is_video else "image/jpeg")
    if is_video:
        register_data = linkedin_api_request(
            "POST",
            "/rest/videos?action=initializeUpload",
            account.access_token,
            json_body={"initializeUploadRequest": {"owner": author_urn}},
        )
        value = register_data.get("value", {})
        upload_instructions = value.get("uploadInstructions") or []
        upload_url = ""
        if upload_instructions and isinstance(upload_instructions[0], dict):
            upload_url = str(upload_instructions[0].get("uploadUrl") or "").strip()
        asset = str(value.get("video") or "").strip()
        if not upload_url or not asset:
            raise RuntimeError("LinkedIn video initializeUpload did not return upload instructions and video URN.")
        linkedin_upload_binary(upload_url, media_path, mime_type)
        wait_for_linkedin_media_asset(account, asset, "videos")
        return asset, media_category

    register_data = linkedin_api_request(
        "POST",
        "/rest/images?action=initializeUpload",
        account.access_token,
        json_body={"initializeUploadRequest": {"owner": author_urn}},
    )
    value = register_data.get("value", {})
    upload_url = str(value.get("uploadUrl") or "").strip()
    asset = str(value.get("image") or "").strip()
    if not upload_url or not asset:
        raise RuntimeError("LinkedIn image initializeUpload did not return upload URL and image URN.")

    linkedin_upload_binary(upload_url, media_path, mime_type)
    wait_for_linkedin_media_asset(account, asset, "images")
    return asset, media_category


def post_to_linkedin_live(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    if not account.access_token:
        raise RuntimeError("Missing LinkedIn access_token")

    author_urn = resolve_linkedin_author_urn(account)
    validate_linkedin_account_binding(account)

    if media_paths:
        video_count = sum(1 for path in media_paths if is_video_path(path))
        if video_count > 1:
            raise RuntimeError("LinkedIn supports only one video per post in this implementation.")
        if video_count and len(media_paths) > 1:
            raise RuntimeError("LinkedIn post media types cannot be mixed (image + video).")

    payload: dict[str, Any] = {
        "author": author_urn,
        "commentary": post.content or "",
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    if media_paths:
        uploaded_media: list[tuple[str, str]] = [linkedin_register_upload(account, author_urn, media) for media in media_paths]
        media_urns = [asset_urn for asset_urn, _category in uploaded_media]
        media_category = uploaded_media[0][1]
        if media_category == "VIDEO":
            payload["content"] = {
                "media": {
                    "id": media_urns[0],
                    "title": post.content[:200] if post.content else "Video post",
                }
            }
        elif len(media_urns) == 1:
            payload["content"] = {"media": {"id": media_urns[0]}}
        else:
            payload["content"] = {"multiImage": {"images": [{"id": media_urn} for media_urn in media_urns]}}

    response = requests.post(
        "https://api.linkedin.com/rest/posts",
        headers=linkedin_api_headers(account.access_token, json_content=True),
        json=payload,
        timeout=API_TIMEOUT_SECONDS,
    )
    ensure_success(response, "LinkedIn")
    post_id = response.headers.get("x-restli-id") or response.headers.get("X-RestLi-Id")
    return {"success": True, "platform": "linkedin", "post_id": post_id, "post_url": build_platform_post_url(account, "linkedin", post_id)}


def post_to_instagram_live(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    if not account.access_token:
        raise RuntimeError("Missing Instagram access_token")
    if not account.page_id_external:
        raise RuntimeError("Instagram page_id_external must be set to the Instagram business account ID.")
    if not media_paths:
        raise RuntimeError("Instagram requires at least one media file.")

    normalize_media_for_publishing(media_paths)

    invalid_images: list[str] = []
    for media_path in media_paths:
        details = instagram_ratio_details_for_path(media_path)
        if details and not details["accepted"]:
            invalid_images.append(
                f"{Path(media_path).name} ({details['width']}x{details['height']}, ratio {details['ratio']:.2f}:1)"
            )
    if invalid_images:
        raise RuntimeError(
            "Instagram feed images must stay within an aspect ratio range of 4:5 to 1.91:1. "
            f"Fix these images before publishing: {', '.join(invalid_images)}."
        )

    ig_user_id = account.page_id_external
    if len(media_paths) > 10:
        raise RuntimeError("Instagram carousel publishing supports up to 10 media items per post.")

    media_urls: list[str] = []
    for media_path in media_paths:
        media_url = make_public_media_url(media_path)
        if not media_url:
            raise RuntimeError("Instagram requires a public media URL. Set PUBLIC_BASE_URL for uploaded files.")
        logger.info(
            "Instagram media preflight for post %s asset=%s url=%s",
            post.id,
            media_path,
            media_url,
        )
        validate_remote_media_url(media_url, expect_video=is_video_path(media_path))
        media_urls.append(media_url)

    caption = post.content or ""
    if len(media_paths) == 1:
        creation_id = create_instagram_media_container(
            account,
            ig_user_id,
            media_url=media_urls[0],
            is_video=is_video_path(media_paths[0]),
            caption=caption,
        )
        wait_for_instagram_container(account, creation_id)
    else:
        child_ids: list[str] = []
        for media_path, media_url in zip(media_paths, media_urls):
            child_id = create_instagram_media_container(
                account,
                ig_user_id,
                media_url=media_url,
                is_video=is_video_path(media_path),
                is_carousel_item=True,
            )
            wait_for_instagram_container(account, child_id)
            child_ids.append(child_id)

        creation_id = create_instagram_media_container(
            account,
            ig_user_id,
            caption=caption,
            children=child_ids,
        )
        wait_for_instagram_container(account, creation_id)

    def publish_action() -> dict[str, Any]:
        publish_response = requests.post(
            f"https://graph.facebook.com/v25.0/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": account.access_token},
            timeout=API_TIMEOUT_SECONDS,
        )
        return ensure_success(publish_response, "Instagram")

    publish_data = run_instagram_transient_retry("media publish", publish_action)
    post_id = publish_data.get("id")
    post_url = fetch_instagram_permalink(account, post_id)
    return {"success": True, "platform": "instagram", "post_id": post_id, "post_url": post_url}


def resolve_pinterest_board_id(account: SocialAccount) -> str:
    if account.page_id_external:
        return account.page_id_external

    if not account.access_token:
        raise RuntimeError("Missing Pinterest access_token")

    response = requests.get(
        "https://api.pinterest.com/v5/boards",
        headers={"Authorization": f"Bearer {account.access_token}"},
        timeout=API_TIMEOUT_SECONDS,
    )
    payload = ensure_success(response, "Pinterest")
    items = payload.get("items", [])
    if not items:
        raise RuntimeError("No Pinterest boards available. Set page_id_external to a valid board ID.")
    return items[0]["id"]


def post_to_pinterest_live(account: SocialAccount, post: Post, media_paths: list[str]) -> dict[str, Any]:
    if not account.access_token:
        raise RuntimeError("Missing Pinterest access_token")
    if not media_paths:
        raise RuntimeError("Pinterest requires at least one image.")
    if len(media_paths) > 1:
        raise RuntimeError("Pinterest multi-media pin creation is not enabled in this phase.")
    if is_video_path(media_paths[0]):
        raise RuntimeError("Pinterest video publish is not enabled in this phase.")

    media_url = make_public_media_url(media_paths[0])
    if not media_url:
        raise RuntimeError("Pinterest requires a public media URL. Set PUBLIC_BASE_URL for uploaded files.")

    board_id = resolve_pinterest_board_id(account)
    payload = {
        "board_id": board_id,
        "title": (post.content or "MSS SoME-Auto Post")[:100],
        "description": post.content or "",
        "media_source": {"source_type": "image_url", "url": media_url},
    }
    response = requests.post(
        "https://api.pinterest.com/v5/pins",
        headers={
            "Authorization": f"Bearer {account.access_token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=API_TIMEOUT_SECONDS,
    )
    data = ensure_success(response, "Pinterest")
    post_id = data.get("id")
    return {"success": True, "platform": "pinterest", "post_id": post_id, "post_url": build_platform_post_url(account, "pinterest", post_id)}


def publish_to_platform(
    account: SocialAccount,
    post: Post,
    media_paths: list[str],
    live_posting_enabled: bool,
) -> dict[str, Any]:
    if not account.is_active:
        return {"success": False, "platform": account.platform, "error": "Account is inactive"}

    if not live_posting_enabled:
        return simulate_platform_post(account, post, media_paths)

    try:
        if account.platform == "facebook":
            return post_to_facebook_live(account, post, media_paths)
        if account.platform == "twitter":
            return post_to_twitter_live(account, post, media_paths)
        if account.platform == "linkedin":
            return post_to_linkedin_live(account, post, media_paths)
        if account.platform == "instagram":
            return post_to_instagram_live(account, post, media_paths)
        if account.platform == "pinterest":
            return post_to_pinterest_live(account, post, media_paths)

        return {"success": False, "platform": account.platform, "error": "Unsupported platform"}
    except Exception as error:
        error_message = str(error)
        if account.platform == "facebook" and ("(#10)" in error_message or '"code": 10' in error_message):
            error_message = (
                f"{error_message} "
                "Verify the app has pages_manage_posts, pages_read_engagement, and publish_video "
                "for video posts, and that the connected person can CREATE_CONTENT on the Facebook Page."
            )
        logger.error("Live posting error on %s: %s", account.platform, error_message)
        return {"success": False, "platform": account.platform, "error": error_message}


def record_platform_post_reference(
    post: Post,
    account: SocialAccount,
    platform_post_id: str | None,
    platform_post_url: str | None = None,
) -> None:
    if not platform_post_id:
        return

    reference = PlatformPostReference.query.filter_by(
        internal_post_id=post.id,
        social_account_id=account.id,
        platform_post_id=str(platform_post_id),
    ).first()
    if not reference:
        reference = PlatformPostReference(
            internal_post_id=post.id,
            social_account_id=account.id,
            platform=account.platform,
            platform_post_id=str(platform_post_id),
        )
        db.session.add(reference)

    reference.platform = account.platform
    reference.permalink = platform_post_url or post.platform_url_map().get(account.platform)
    reference.published_at = post.posted_at or utcnow()
    reference.media_type = post.media_type
    reference.caption_preview = (post.content or "")[:280]


def apply_platform_result(
    post: Post,
    platform: str,
    platform_post_id: str | None,
    platform_post_url: str | None = None,
    account: SocialAccount | None = None,
) -> None:
    if platform == "facebook":
        post.facebook_post_id = platform_post_id
    elif platform == "instagram":
        post.instagram_post_id = platform_post_id
    elif platform == "linkedin":
        post.linkedin_post_id = platform_post_id
    elif platform == "twitter":
        post.twitter_post_id = platform_post_id
    elif platform == "pinterest":
        post.pinterest_post_id = platform_post_id

    url_map = post.platform_url_map()
    if platform_post_url:
        url_map[platform] = platform_post_url
    else:
        url_map.pop(platform, None)
    post.platform_post_urls = json.dumps(url_map) if url_map else None
    if account:
        record_platform_post_reference(post, account, platform_post_id, platform_post_url)


def finalize_post_status_after_execution(post: Post, automated_results: list[dict[str, Any]]) -> None:
    automated_failures = [result for result in automated_results if not result.get("success")]
    automated_successes = [result for result in automated_results if result.get("success")]
    manual_pending = post_requires_manual_linkedin(post) and not post.linkedin_manual_done_at

    if automated_failures and not automated_successes:
        post.status = "failed"
        post.posted_at = None
        post.error_message = json.dumps(automated_failures)
        return

    if manual_pending:
        post.status = "manual_pending"
        post.posted_at = None
        post.error_message = json.dumps(automated_failures) if automated_failures else None
        return

    if automated_successes or (post_requires_manual_linkedin(post) and not automated_results):
        post.status = "posted"
        post.posted_at = post.posted_at or utcnow()
        post.error_message = json.dumps(automated_failures) if automated_failures else None
        return

    post.status = "failed"
    post.posted_at = None
    post.error_message = json.dumps(automated_failures or [{"success": False, "platform": "none", "error": "No platforms were processed."}])


def refresh_post_after_linkedin_manual_update(post: Post) -> None:
    if not post_requires_manual_linkedin(post):
        return

    if not post.linkedin_manual_done_at:
        if post.status == "posted":
            post.status = "manual_pending"
            post.posted_at = None
        return

    if automated_platforms_for_post(post):
        if post.status == "manual_pending":
            post.status = "posted"
            post.posted_at = post.posted_at or utcnow()
        return

    if post.scheduled_time and post.scheduled_time > utcnow():
        post.status = "scheduled"
        post.posted_at = None
        return

    post.status = "posted"
    post.posted_at = post.posted_at or utcnow()


def sync_planning_row_post_color(post: Post) -> None:
    row = PlanningRow.query.filter_by(scheduled_post_id=post.id).first()
    if not row:
        return
    if post.status == "posted":
        row.job_color = PLANNING_POSTED_COLOR
        return
    if post.status == "failed":
        row.job_color = PLANNING_FAILED_COLOR
        return
    if post.status in {"scheduled", "posting", "manual_pending"}:
        row.job_color = PLANNING_SCHEDULED_COLOR


def detach_planning_row_from_post(post: Post) -> None:
    row = PlanningRow.query.filter_by(scheduled_post_id=post.id).first()
    if not row:
        return

    row.scheduled_post_id = None
    if post.status == "posted":
        row.job_color = PLANNING_POSTED_COLOR
    elif post.status == "failed":
        row.job_color = PLANNING_FAILED_COLOR
    else:
        row.job_color = PLANNING_READY_COLOR


def apply_planning_row_non_actionable_state(row: PlanningRow, next_is_non_actionable: bool) -> None:
    current_is_non_actionable = bool(row.is_non_actionable)
    if current_is_non_actionable == next_is_non_actionable:
        return

    if next_is_non_actionable:
        linked_post = Post.query.get(row.scheduled_post_id) if row.scheduled_post_id else None
        if linked_post:
            if linked_post.status == "posting":
                raise RuntimeError("This row is currently publishing and cannot be disabled right now.")

            media_refs = set(linked_post.media_list())
            if linked_post.status in {"scheduled", "draft"}:
                cancel_pending_facebook_remote_schedule(linked_post)
                detach_planning_row_from_post(linked_post)
                db.session.delete(linked_post)
                cleanup_unreferenced_uploads(media_refs)
            else:
                detach_planning_row_from_post(linked_post)
        elif row.scheduled_post_id:
            row.scheduled_post_id = None

        clear_planning_warning_state(row, "designer")
        clear_planning_warning_state(row, "clarise")
        clear_planning_warning_state(row, "ready")
        row.job_color = "#D9D9D9"
        row.is_non_actionable = True
        return

    row.is_non_actionable = False
    if not (row.job_color or "").strip():
        row.job_color = "#D9D9D9"


def schedule_post_from_planning_row_record(
    row: PlanningRow,
    *,
    require_ready_color: bool = True,
    trigger: str = "manual",
) -> tuple[PlanningRow, Post]:
    page = row.sheet.page if row.sheet else None
    if page is None:
        raise RuntimeError("Planning row is not linked to a page.")

    if row.is_non_actionable:
        raise RuntimeError("This is a non-actionable planning row and cannot be scheduled.")

    if row.scheduled_post_id:
        raise RuntimeError("Planning row is already linked to a scheduled post.")

    if require_ready_color and (row.job_color or "").upper() != PLANNING_READY_COLOR:
        raise RuntimeError(
            f"Job Nr color must be {PLANNING_READY_COLOR} (Content approved, schedule post) before scheduling."
        )

    if not str(row.time_value or "").strip():
        row.time_value = "10:00"
    scheduled_dt = parse_planning_schedule_datetime(row.date_value or "", row.time_value or "")
    if not scheduled_dt:
        raise RuntimeError("Invalid Date/Time in planning row. Use date + time values.")
    if scheduled_dt <= utcnow():
        raise RuntimeError("Planning rows can only be scheduled for future date/time values.")

    content = (row.post_copy or "").strip()
    if not content:
        raise RuntimeError("Post Copy is required to schedule from planning row.")

    media_items = row.creative_media_list()
    if not media_items:
        raise RuntimeError("Creative media is required (column 13) to schedule.")
    validate_page_creative_media(page, media_items)

    platforms = get_active_page_platforms(page)
    if not platforms:
        raise RuntimeError("No active social platforms connected for this page.")

    post = Post(
        page_id=page.id,
        content=content,
        media_paths=json.dumps(media_items),
        media_type=detect_media_type(media_items),
        platforms=json.dumps(platforms),
        scheduled_time=scheduled_dt,
        status="scheduled",
    )
    db.session.add(post)
    db.session.commit()

    row.scheduled_post_id = post.id
    row.job_color = PLANNING_SCHEDULED_COLOR
    db.session.commit()
    logger.info(
        "Planning row %s auto-created scheduled post %s via %s trigger for %s.",
        row.id,
        post.id,
        trigger,
        scheduled_dt.isoformat(),
    )
    return row, post


def publish_post_from_planning_row_record(
    row: PlanningRow,
    *,
    require_ready_color: bool = True,
    trigger: str = "manual_publish_now",
) -> tuple[PlanningRow, Post, list[dict[str, Any]]]:
    page = row.sheet.page if row.sheet else None
    if page is None:
        raise RuntimeError("Planning row is not linked to a page.")

    if row.is_non_actionable:
        raise RuntimeError("This is a non-actionable planning row and cannot be published.")

    if row.scheduled_post_id:
        raise RuntimeError("Planning row is already linked to a post.")

    if require_ready_color and (row.job_color or "").upper() != PLANNING_READY_COLOR:
        raise RuntimeError(
            f"Job Nr color must be {PLANNING_READY_COLOR} (Content approved, schedule post) before publishing."
        )

    content = (row.post_copy or "").strip()
    if not content:
        raise RuntimeError("Post Copy is required to publish from planning row.")

    media_items = row.creative_media_list()
    if not media_items:
        raise RuntimeError("Creative media is required (column 13) to publish.")
    validate_page_creative_media(page, media_items)

    platforms = get_active_page_platforms(page)
    if not platforms:
        raise RuntimeError("No active social platforms connected for this page.")

    post = Post(
        page_id=page.id,
        content=content,
        media_paths=json.dumps(media_items),
        media_type=detect_media_type(media_items),
        platforms=json.dumps(platforms),
        scheduled_time=utcnow(),
        status="posting",
    )
    db.session.add(post)
    db.session.commit()

    row.scheduled_post_id = post.id
    row.job_color = PLANNING_SCHEDULED_COLOR
    db.session.commit()

    logger.info("Planning row %s created immediate publish post %s via %s trigger.", row.id, post.id, trigger)
    results = execute_post(post.id)

    try:
        db.session.refresh(row)
        db.session.refresh(post)
    except Exception:
        pass

    return row, post, results


def execute_post(post_id: int) -> list[dict[str, Any]]:
    post = Post.query.get(post_id)
    if not post:
        logger.error("Post %s not found.", post_id)
        return []

    if post.status not in {"scheduled", "posting"}:
        logger.info("Post %s is in status '%s', skipping.", post_id, post.status)
        return []

    media_paths = post.media_list()
    platforms = post.platform_list()

    if not platforms:
        post.status = "failed"
        post.error_message = "No target platforms selected."
        sync_planning_row_post_color(post)
        db.session.commit()
        return [{"success": False, "platform": "none", "error": "No platforms selected"}]

    page = Page.query.get(post.page_id)
    if not page:
        post.status = "failed"
        post.error_message = "Page not found."
        sync_planning_row_post_color(post)
        db.session.commit()
        return [{"success": False, "platform": "none", "error": "Page not found"}]

    resolved_media = [
        item if item.startswith(("http://", "https://")) else str(resolve_upload_path(item))
        for item in media_paths
    ]
    normalize_media_for_publishing(resolved_media)
    live_posting_enabled = should_use_live_posting(page.id)
    logger.info(
        "Executing post %s for page=%s status=%s scheduled_time=%s platforms=%s live_posting=%s",
        post.id,
        page.id,
        post.status,
        post.scheduled_time.isoformat() if post.scheduled_time else None,
        platforms,
        live_posting_enabled,
    )
    results: list[dict[str, Any]] = []
    automated_results: list[dict[str, Any]] = []

    for platform in platforms:
        if platform == "facebook" and post.facebook_remote_post_id:
            result = scheduled_facebook_remote_result(post)
            results.append(result)
            automated_results.append(result)
            account = SocialAccount.query.filter_by(
                page_id=page.id,
                platform=platform,
                is_active=True,
            ).first()
            if account:
                record_platform_post_reference(
                    post,
                    account,
                    result.get("post_id"),
                    result.get("post_url"),
                )
            continue

        if platform == "linkedin":
            results.append(
                {
                    "success": bool(post.linkedin_manual_done_at),
                    "platform": "linkedin",
                    "manual": True,
                    "pending": not bool(post.linkedin_manual_done_at),
                    "message": (
                        "LinkedIn manual assist already completed."
                        if post.linkedin_manual_done_at
                        else "LinkedIn manual assist is still pending."
                    ),
                }
            )
            continue

        account = SocialAccount.query.filter_by(
            page_id=page.id,
            platform=platform,
            is_active=True,
        ).first()

        if not account:
            results.append(
                {
                    "success": False,
                    "platform": platform,
                    "error": f"No active {platform} account connected to this page.",
                }
            )
            continue

        logger.info(
            "Starting platform publish for post %s on %s with %s media item(s).",
            post.id,
            platform,
            len(resolved_media),
        )
        result = publish_to_platform(account, post, resolved_media, live_posting_enabled=live_posting_enabled)
        results.append(result)
        automated_results.append(result)

        if result.get("success"):
            if not result.get("skip_apply_platform_result"):
                apply_platform_result(post, platform, result.get("post_id"), result.get("post_url"), account=account)
            logger.info("Platform publish succeeded for post %s on %s.", post.id, platform)
        else:
            logger.info(
                "Platform publish failed for post %s on %s: %s",
                post.id,
                platform,
                result.get("error"),
            )

    finalize_post_status_after_execution(post, automated_results)
    sync_planning_row_post_color(post)
    try:
        db.session.commit()
    except StaleDataError:
        db.session.rollback()
        logger.warning("Post %s was deleted while publish results were being saved.", post_id)
    logger.info("Finished post %s with status=%s results=%s", post.id, post.status, results)
    return results
