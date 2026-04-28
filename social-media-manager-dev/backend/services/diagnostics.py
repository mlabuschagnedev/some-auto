from __future__ import annotations

from ..auth import require_roles
from ..integrations import get_integration_check_payload
from ..models import Page, Post, SocialAccount
from ..routes.common import (
    Any,
    APP_TIMEZONE_NAME,
    Blueprint,
    jsonify,
    jwt_required,
    request,
    scheduler,
    utcnow,
)

def health() -> Any:
    return jsonify(
        {
            "status": "healthy",
            "app": "Sample SoMe-Auto",
            "timestamp": utcnow().isoformat(),
            "timezone": APP_TIMEZONE_NAME,
        }
    )

def scheduler_status() -> Any:
    jobs = scheduler.get_jobs()
    posting_posts = Post.query.filter_by(status="posting").order_by(Post.scheduled_time.asc()).all()
    scheduled_posts = Post.query.filter_by(status="scheduled").order_by(Post.scheduled_time.asc()).all()
    return jsonify(
        {
            "running": scheduler.running,
            "scheduled_jobs": len(jobs),
            "posting_posts": [
                {
                    "id": post.id,
                    "page_id": post.page_id,
                    "scheduled_time": post.scheduled_time.isoformat() if post.scheduled_time else None,
                    "created_at": post.created_at.isoformat(),
                }
                for post in posting_posts
            ],
            "queued_posts": [
                {
                    "id": post.id,
                    "page_id": post.page_id,
                    "scheduled_time": post.scheduled_time.isoformat() if post.scheduled_time else None,
                }
                for post in scheduled_posts
            ],
            "jobs": [
                {
                    "id": job.id,
                    "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                }
                for job in jobs
            ],
        }
    )

def token_status() -> Any:
    page_id = request.args.get("page_id", type=int)
    accounts_query = SocialAccount.query.filter_by(is_active=True)
    if page_id is not None:
        Page.query.get_or_404(page_id)
        accounts_query = accounts_query.filter(SocialAccount.page_id == page_id)
    accounts = accounts_query.all()
    rows: list[dict[str, Any]] = []

    for account in accounts:
        days_until = None
        needs_refresh = False
        if account.token_expires_at:
            days_until = (account.token_expires_at - utcnow()).days
            needs_refresh = days_until <= 3

        rows.append(
            {
                "id": account.id,
                "page_id": account.page_id,
                "page_name": account.page.name if account.page else None,
                "platform": account.platform,
                "account_name": account.account_name,
                "expires_at": account.token_expires_at.isoformat() if account.token_expires_at else None,
                "last_refreshed": account.last_refreshed.isoformat() if account.last_refreshed else None,
                "days_until_expiry": days_until,
                "needs_refresh": needs_refresh,
            }
        )

    return jsonify(rows)

def integration_check() -> Any:
    return jsonify(get_integration_check_payload())

def integration_check_for_page(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    return jsonify(get_integration_check_payload(page_id=page_id))

