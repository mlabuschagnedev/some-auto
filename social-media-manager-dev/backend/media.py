from __future__ import annotations

from . import app as core
from .models import Page, PlanningRow, Post, db

Any = core.Any
API_TIMEOUT_SECONDS = core.API_TIMEOUT_SECONDS
IMAGE_DIR = core.IMAGE_DIR
Image = core.Image
INSTAGRAM_IMAGE_RATIO_MAX = core.INSTAGRAM_IMAGE_RATIO_MAX
INSTAGRAM_IMAGE_RATIO_MIN = core.INSTAGRAM_IMAGE_RATIO_MIN
INSTAGRAM_RATIO_EPSILON = core.INSTAGRAM_RATIO_EPSILON
Path = core.Path
UPLOAD_DIR = core.UPLOAD_DIR
VIDEO_EXTENSIONS = core.VIDEO_EXTENSIONS
VIDEO_DIR = core.VIDEO_DIR
app = core.app
hashlib = core.hashlib
hmac = core.hmac
json_loads_safe = core.json_loads_safe
logger = core.logger
mimetypes = core.mimetypes
os = core.os
quote = core.quote
requests = core.requests
secure_filename = core.secure_filename
time = core.time
uuid = core.uuid

PUBLISH_IMAGE_MAX_WIDTH = int(os.environ.get("PUBLISH_IMAGE_MAX_WIDTH", "1440"))
PUBLISH_IMAGE_JPEG_QUALITY = int(os.environ.get("PUBLISH_IMAGE_JPEG_QUALITY", "92"))

def detect_media_type(paths: list[str]) -> str | None:
    if not paths:
        return None

    has_images = False
    has_videos = False
    for item in paths:
        ext = Path(item).suffix.lower()
        if ext in VIDEO_EXTENSIONS:
            has_videos = True
        else:
            has_images = True

    if has_images and has_videos:
        return "mixed"
    if has_videos:
        return "video"
    return "image"


def get_active_page_platforms(page: Page) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for account in page.social_accounts:
        if account.is_active and account.platform not in seen:
            ordered.append(account.platform)
            seen.add(account.platform)
    return ordered

def build_local_media_url(media_path: str) -> str:
    if str(media_path).startswith(("http://", "https://")):
        return str(media_path)
    relative = str(Path(media_path)).replace("\\", "/")
    return f"/uploads/{quote(relative, safe='/')}"


def page_has_active_platform(page: Page, platform: str) -> bool:
    return platform in get_active_page_platforms(page)


def page_requires_fb_instagram_media_guard(page: Page) -> bool:
    active_platforms = set(get_active_page_platforms(page))
    return {"facebook", "instagram"}.issubset(active_platforms)


def instagram_ratio_details_for_path(media_path: str) -> dict[str, Any] | None:
    resolved = Path(media_path)
    if not resolved.exists() or is_video_path(str(resolved)):
        return None

    with Image.open(resolved) as image:
        width, height = image.size

    if width <= 0 or height <= 0:
        raise RuntimeError(f"Image has invalid dimensions: {resolved.name}")

    ratio = width / height
    accepted = (INSTAGRAM_IMAGE_RATIO_MIN - INSTAGRAM_RATIO_EPSILON) <= ratio <= (
        INSTAGRAM_IMAGE_RATIO_MAX + INSTAGRAM_RATIO_EPSILON
    )
    return {
        "width": width,
        "height": height,
        "ratio": ratio,
        "accepted": accepted,
    }


def normalize_image_for_publishing(media_path: str) -> bool:
    resolved = Path(media_path)
    if not resolved.exists() or is_video_path(str(resolved)):
        return False

    with Image.open(resolved) as image:
        width, height = image.size
        image_format = (image.format or resolved.suffix.lstrip(".") or "JPEG").upper()
        if image_format == "JPG":
            image_format = "JPEG"

        if width <= 0 or height <= 0:
            raise RuntimeError(f"Image has invalid dimensions: {resolved.name}")
        if width <= PUBLISH_IMAGE_MAX_WIDTH:
            return False

        target_height = max(1, round(height * (PUBLISH_IMAGE_MAX_WIDTH / width)))
        resized = image.resize((PUBLISH_IMAGE_MAX_WIDTH, target_height), Image.Resampling.LANCZOS)

        save_kwargs: dict[str, Any] = {}
        if image_format in {"JPEG", "WEBP"}:
            if resized.mode not in {"RGB", "L"}:
                resized = resized.convert("RGB")
            save_kwargs["quality"] = max(1, min(PUBLISH_IMAGE_JPEG_QUALITY, 95))
            save_kwargs["optimize"] = True
            if image_format == "JPEG":
                save_kwargs["progressive"] = True
        elif image_format == "PNG":
            save_kwargs["optimize"] = True

        resized.save(resolved, image_format, **save_kwargs)

    logger.info(
        "Resized publishing image %s from %sx%s to %sx%s.",
        resolved,
        width,
        height,
        PUBLISH_IMAGE_MAX_WIDTH,
        target_height,
    )
    return True


def normalize_media_for_publishing(media_paths: list[str]) -> list[str]:
    for media_path in media_paths:
        if str(media_path).startswith(("http://", "https://")):
            continue
        normalize_image_for_publishing(media_path)
    return media_paths


def validate_page_creative_media(page: Page, media_refs: list[str]) -> None:
    if not media_refs:
        return

    resolved_media = [
        item if item.startswith(("http://", "https://")) else str(resolve_upload_path(item))
        for item in media_refs
    ]
    video_count = sum(1 for item in resolved_media if is_video_path(item))
    image_count = len(resolved_media) - video_count

    if page_requires_fb_instagram_media_guard(page):
        if video_count > 1:
            raise RuntimeError(
                "When Facebook and Instagram are both connected on a page, creatives may include only one video."
            )
        if video_count and image_count:
            raise RuntimeError(
                "When Facebook and Instagram are both connected on a page, creatives cannot mix images and videos."
            )

    if not page_has_active_platform(page, "instagram"):
        return

    invalid_images: list[str] = []
    for item in resolved_media:
        normalize_image_for_publishing(item)
        details = instagram_ratio_details_for_path(item)
        if not details or details["accepted"]:
            continue
        invalid_images.append(
            f"{Path(item).name} ({details['width']}x{details['height']}, ratio {details['ratio']:.2f}:1)"
        )

    if invalid_images:
        raise RuntimeError(
            "Instagram feed images must stay within an aspect ratio range of 4:5 to 1.91:1. "
            f"Fix or crop these images before saving: {', '.join(invalid_images)}."
        )


def store_upload(file_storage) -> str:
    original = secure_filename(file_storage.filename)
    ext = Path(original).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"

    if ext in VIDEO_EXTENSIONS:
        target_dir = VIDEO_DIR
        relative = f"videos/{unique_name}"
    else:
        target_dir = IMAGE_DIR
        relative = f"images/{unique_name}"

    target_path = target_dir / unique_name
    file_storage.save(target_path)
    if ext not in VIDEO_EXTENSIONS:
        normalize_image_for_publishing(str(target_path))
    return relative


def resolve_upload_path(relative: str) -> Path:
    return UPLOAD_DIR / relative


def normalize_managed_upload_ref(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned or cleaned.startswith(("http://", "https://")):
        return None
    if cleaned.startswith("/uploads/"):
        cleaned = cleaned.removeprefix("/uploads/")
    if cleaned.startswith("/public/uploads/"):
        cleaned = cleaned.removeprefix("/public/uploads/")
    cleaned = cleaned.replace("\\", "/").lstrip("/")
    if not cleaned:
        return None
    try:
        resolved = (UPLOAD_DIR / cleaned).resolve()
        resolved.relative_to(UPLOAD_DIR.resolve())
    except Exception:
        return None
    return cleaned


def iter_all_referenced_upload_refs() -> set[str]:
    refs: set[str] = set()

    for page in Page.query.with_entities(Page.image_path).all():
        ref = normalize_managed_upload_ref(page.image_path)
        if ref:
            refs.add(ref)

    for post in Post.query.with_entities(Post.media_paths).all():
        media_items = json_loads_safe(post.media_paths, [])
        if isinstance(media_items, list):
            for item in media_items:
                ref = normalize_managed_upload_ref(str(item))
                if ref:
                    refs.add(ref)

    for row in PlanningRow.query.with_entities(PlanningRow.creative_media_paths, PlanningRow.creative_media_path).all():
        media_items = json_loads_safe(row.creative_media_paths, [])
        if isinstance(media_items, list):
            for item in media_items:
                ref = normalize_managed_upload_ref(str(item))
                if ref:
                    refs.add(ref)
        fallback_ref = normalize_managed_upload_ref(row.creative_media_path)
        if fallback_ref:
            refs.add(fallback_ref)

    return refs


def delete_managed_upload_file(ref: str) -> bool:
    normalized = normalize_managed_upload_ref(ref)
    if not normalized:
        return False
    target = resolve_upload_path(normalized)
    if not target.exists() or not target.is_file():
        return False
    try:
        target.unlink()
        return True
    except Exception as error:
        logger.warning("Failed to delete upload %s: %s", normalized, error)
        return False


def cleanup_unreferenced_uploads(candidate_refs: list[str] | set[str]) -> int:
    normalized_candidates = {normalize_managed_upload_ref(ref) for ref in candidate_refs}
    normalized_candidates.discard(None)
    if not normalized_candidates:
        return 0

    in_use = iter_all_referenced_upload_refs()
    removed = 0
    for ref in sorted(normalized_candidates):
        if ref in in_use:
            continue
        if delete_managed_upload_file(ref):
            removed += 1
    return removed


def collect_page_upload_refs(page: Page) -> set[str]:
    refs: set[str] = set()
    image_ref = normalize_managed_upload_ref(page.image_path)
    if image_ref:
        refs.add(image_ref)

    for post in page.posts:
        for media in post.media_list():
            ref = normalize_managed_upload_ref(media)
            if ref:
                refs.add(ref)

    if page.planning_sheet:
        for row in page.planning_sheet.rows:
            for media in row.creative_media_list():
                ref = normalize_managed_upload_ref(media)
                if ref:
                    refs.add(ref)

    return refs


def prune_orphaned_upload_files() -> int:
    referenced = iter_all_referenced_upload_refs()
    orphaned: list[str] = []
    for file_path in UPLOAD_DIR.rglob("*"):
        if not file_path.is_file():
            continue
        try:
            ref = str(file_path.resolve().relative_to(UPLOAD_DIR.resolve())).replace("\\", "/")
        except Exception:
            continue
        if ref not in referenced:
            orphaned.append(ref)

    removed = 0
    for ref in orphaned:
        if delete_managed_upload_file(ref):
            removed += 1

    if removed:
        logger.info("Pruned %s orphaned upload file(s).", removed)
    return removed


def is_video_path(media_path: str) -> bool:
    return Path(media_path).suffix.lower() in VIDEO_EXTENSIONS


def get_media_signing_secret() -> str:
    return os.environ.get("MEDIA_URL_SIGNING_SECRET", app.config["JWT_SECRET_KEY"])


def resolve_upload_relative_path(media_path: str) -> str | None:
    media_candidate = Path(media_path)
    if media_candidate.is_absolute():
        try:
            rel = media_candidate.resolve().relative_to(UPLOAD_DIR.resolve())
            return str(rel).replace("\\", "/")
        except ValueError:
            return None

    return str(media_candidate).replace("\\", "/").lstrip("/")


def build_signed_media_url(relative_path: str, ttl_seconds: int = 3600) -> str | None:
    public_base = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not public_base:
        return None

    expires = int(time.time()) + max(ttl_seconds, 60)
    payload = f"{relative_path}:{expires}"
    signature = hmac.new(get_media_signing_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{public_base}/public/uploads/{quote(relative_path)}?exp={expires}&sig={signature}"


def is_valid_signed_media_request(relative_path: str, exp_raw: str | None, signature: str | None) -> bool:
    if not exp_raw or not signature:
        return False

    try:
        expires = int(exp_raw)
    except (TypeError, ValueError):
        return False

    if expires < int(time.time()):
        return False

    payload = f"{relative_path}:{expires}"
    expected = hmac.new(get_media_signing_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def make_public_media_url(media_path: str, ttl_seconds: int = 3600) -> str | None:
    if media_path.startswith(("http://", "https://")):
        return media_path

    relative = resolve_upload_relative_path(media_path)
    if not relative:
        return None
    public_base = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not public_base:
        return None
    return f"{public_base}/uploads/{quote(relative, safe='/')}"


def validate_remote_media_url(media_url: str, *, expect_video: bool) -> None:
    try:
        response = requests.get(media_url, stream=True, timeout=API_TIMEOUT_SECONDS)
    except Exception as error:
        raise RuntimeError(f"Public media URL is unreachable: {error}") from error

    try:
        if response.status_code != 200:
            raise RuntimeError(f"Public media URL returned HTTP {response.status_code}.")
        content_type = str(response.headers.get("Content-Type") or "").lower()
        expected_prefix = "video/" if expect_video else "image/"
        if not content_type.startswith(expected_prefix):
            raise RuntimeError(
                f"Public media URL returned content type '{content_type or 'unknown'}' instead of '{expected_prefix}...'."
            )
    finally:
        response.close()
