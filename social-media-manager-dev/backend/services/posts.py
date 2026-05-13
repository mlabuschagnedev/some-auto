from __future__ import annotations

from ..auth import current_user, require_owner, require_roles
from ..models import Page, Post, db
from ..publishing import (
    apply_platform_result,
    cancel_pending_facebook_remote_schedule,
    detach_planning_row_from_post,
    execute_post,
    post_requires_manual_linkedin,
    refresh_post_after_linkedin_manual_update,
    sync_planning_row_post_color,
)
from ..media import cleanup_unreferenced_uploads
from ..routes.common import (
    Any,
    Blueprint,
    PRIMARY_DEVELOPER_DISPLAY_NAME,
    get_json_body,
    joinedload,
    json,
    jsonify,
    jwt_required,
    parse_iso_datetime,
    request,
    utcnow,
)

def get_page_posts(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    posts = Post.query.filter_by(page_id=page_id).order_by(Post.scheduled_time.desc()).all()
    return jsonify([post.to_dict() for post in posts])

def get_all_posts() -> Any:
    status = (request.args.get("status") or "").strip().lower()
    query = Post.query.options(joinedload(Post.page)).order_by(
        Post.scheduled_time.desc().nullslast(),
        Post.created_at.desc(),
    )
    if status:
        query = query.filter(Post.status == status)
    posts = query.all()
    return jsonify([post.to_dict() for post in posts])

def update_linkedin_manual_post(post_id: int) -> Any:
    post = Post.query.get_or_404(post_id)
    if not post_requires_manual_linkedin(post):
        return jsonify({"error": "This post does not include LinkedIn."}), 400

    data = get_json_body()
    raw_done = data.get("done", True)
    if isinstance(raw_done, bool):
        done = raw_done
    else:
        done = str(raw_done).strip().lower() in {"1", "true", "yes", "on"}

    if done:
        actor = current_user()
        post.linkedin_manual_done_at = utcnow()
        post.linkedin_manual_done_by = (
            actor.display_name or actor.username if actor else PRIMARY_DEVELOPER_DISPLAY_NAME
        )
        supplied_url = str(data.get("post_url") or "").strip()
        if supplied_url:
            apply_platform_result(post, "linkedin", post.linkedin_post_id, supplied_url)
        elif post.page and post.page.linkedin_page_url:
            apply_platform_result(post, "linkedin", post.linkedin_post_id, post.page.linkedin_page_url)
    else:
        post.linkedin_manual_done_at = None
        post.linkedin_manual_done_by = None
        url_map = post.platform_url_map()
        url_map.pop("linkedin", None)
        post.platform_post_urls = json.dumps(url_map) if url_map else None

    refresh_post_after_linkedin_manual_update(post)
    sync_planning_row_post_color(post)
    db.session.commit()
    return jsonify(post.to_dict())

def create_post(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    return (
        jsonify(
            {
                "error": "Direct post creation is disabled. Create and schedule posts from the Planning page instead."
            }
        ),
        410,
    )

def update_post(post_id: int) -> Any:
    Post.query.get_or_404(post_id)
    return (
        jsonify(
            {
                "error": "Direct post editing is disabled. Update the planning row, then re-schedule from the Planning page."
            }
        ),
        410,
    )

def delete_post(post_id: int) -> Any:
    post = Post.query.get_or_404(post_id)
    if post.status in {"posting", "manual_pending"}:
        return jsonify({"error": "Posts currently publishing or waiting on LinkedIn manual completion cannot be deleted."}), 400
    if post.status in {"scheduled", "draft"}:
        cancel_pending_facebook_remote_schedule(post)
    media_refs = set(post.media_list())
    detach_planning_row_from_post(post)
    db.session.delete(post)
    db.session.commit()
    cleanup_unreferenced_uploads(media_refs)
    return jsonify({"message": "Post deleted successfully."})

def publish_now(post_id: int) -> Any:
    Post.query.get_or_404(post_id)
    return (
        jsonify(
            {
                "error": "Direct publish is disabled. Use the Planning page schedule flow and let the scheduler handle posting."
            }
        ),
        410,
    )

def retry_post(post_id: int) -> Any:
    post = Post.query.get_or_404(post_id)
    if post.status != "failed":
        return jsonify({"error": "Only failed posts can be retried."}), 400

    post.status = "posting"
    post.error_message = None
    post.facebook_remote_last_error = None
    post.facebook_remote_state = None
    db.session.commit()
    results = execute_post(post.id)
    db.session.refresh(post)
    return jsonify({"message": "Retry finished.", "post": post.to_dict(), "results": results})

def reschedule_post(post_id: int) -> Any:
    post = Post.query.get_or_404(post_id)
    if post.status in {"posting", "manual_pending"}:
        return jsonify({"error": "Posts currently publishing or waiting on manual completion cannot be rescheduled."}), 400

    data = get_json_body()
    scheduled_raw = str(data.get("scheduled_time") or "").strip()
    if not scheduled_raw:
        return jsonify({"error": "scheduled_time is required."}), 400

    try:
        scheduled_time = parse_iso_datetime(scheduled_raw)
    except Exception:
        scheduled_time = None
    if scheduled_time is None:
        return jsonify({"error": "Invalid scheduled_time."}), 400

    if post.facebook_remote_post_id:
        cancel_pending_facebook_remote_schedule(post)
    post.scheduled_time = scheduled_time
    post.status = "scheduled"
    post.posted_at = None
    post.error_message = None
    sync_planning_row_post_color(post)
    db.session.commit()
    return jsonify({"message": "Post rescheduled.", "post": post.to_dict()})
