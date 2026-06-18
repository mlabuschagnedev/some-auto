from __future__ import annotations

from . import app as core
from .integrations import *
from .media import *
from .models import PlanningRow, PlanningSheet, Post, SocialAccount, db
from .planning import *
from .publishing import *

APP_TIMEZONE_NAME = core.APP_TIMEZONE_NAME
PLANNING_AUTO_SCHEDULE_LEAD_MINUTES = core.PLANNING_AUTO_SCHEDULE_LEAD_MINUTES
app = core.app
datetime = core.datetime
joinedload = core.joinedload
logger = core.logger
scheduler = core.scheduler
timedelta = core.timedelta
utcnow = core.utcnow

def auto_schedule_due_planning_rows(now: datetime) -> None:
    window_end = now + timedelta(minutes=PLANNING_AUTO_SCHEDULE_LEAD_MINUTES)
    rows = (
        PlanningRow.query.options(joinedload(PlanningRow.sheet).joinedload(PlanningSheet.page))
        .filter(PlanningRow.scheduled_post_id.is_(None))
        .order_by(PlanningRow.id.asc())
        .all()
    )

    for row in rows:
        page = row.sheet.page if row.sheet else None
        if page is None:
            continue
        if row.is_non_actionable:
            continue
        if str(get_effective_settings(page.id).get("auto_schedule", "true")).lower() != "true":
            continue

        scheduled_dt = parse_planning_schedule_datetime(row.date_value or "", row.time_value or "")
        if not scheduled_dt:
            continue
        if scheduled_dt.date() != now.date():
            continue
        if scheduled_dt > window_end:
            continue

        try:
            schedule_post_from_planning_row_record(row, require_ready_color=True, trigger="auto")
            logger.info(
                "Auto-scheduled planning row %s for page %s because it is within %s minute(s) of its target time.",
                row.id,
                page.id,
                PLANNING_AUTO_SCHEDULE_LEAD_MINUTES,
            )
        except Exception as error:
            logger.debug("Auto-schedule skipped for planning row %s: %s", row.id, error)


def process_due_posts() -> None:
    with app.app_context():
        now = utcnow()
        send_due_planning_warning_emails(now)
        auto_schedule_due_planning_rows(now)
        handoff_pending_facebook_remote_posts(now)
        sync_facebook_remote_posts()
        due_posts = (
            Post.query.filter(Post.status == "scheduled", Post.scheduled_time <= now)
            .order_by(Post.scheduled_time.asc())
            .all()
        )

        if due_posts:
            logger.info(
                "Found %s due post(s) at %s: %s",
                len(due_posts),
                now.isoformat(),
                [post.id for post in due_posts],
            )

        for post in due_posts:
            claimed = Post.query.filter_by(id=post.id, status="scheduled").update({"status": "posting"})
            db.session.commit()
            if claimed:
                logger.info("Claimed scheduled post %s for publishing.", post.id)
                execute_post(post.id)

def auto_refresh_expiring_tokens() -> None:
    with app.app_context():
        check_global_meta_token_health()
        check_global_linkedin_token_health()
        threshold = utcnow() + timedelta(days=3)
        linkedin_status = global_linkedin_status()
        if (
            linkedin_status.get("configured")
            and linkedin_status.get("expires_at")
            and linkedin_status.get("needs_refresh")
            and global_linkedin_refresh_token()
        ):
            try:
                refresh_global_linkedin_token()
            except Exception as error:
                logger.warning("Global LinkedIn token auto-refresh failed: %s", error)
        expiring_accounts = SocialAccount.query.filter(
            SocialAccount.is_active.is_(True),
            SocialAccount.token_expires_at.isnot(None),
            SocialAccount.token_expires_at <= threshold,
        ).all()

        for account in expiring_accounts:
            if account.platform == "linkedin" and global_linkedin_access_token():
                continue
            try:
                refresh_platform_token(account)
                db.session.commit()
                logger.info("Refreshed token for account %s (%s).", account.id, account.platform)
            except Exception as error:
                logger.error("Token refresh failed for account %s (%s): %s", account.id, account.platform, error)


def prune_storage_job() -> None:
    with app.app_context():
        prune_orphaned_upload_files()

def refresh_social_insights_job() -> None:
    with app.app_context():
        from .services.analytics import refresh_all_social_insights

        try:
            result = refresh_all_social_insights(force=False, paced=True)
            logger.info("Social insights refresh finished: %s", result)
        except Exception as error:
            logger.exception("Social insights refresh failed unexpectedly: %s", error)

def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        func=process_due_posts,
        trigger="interval",
        seconds=30,
        id="process_due_posts",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        func=auto_refresh_expiring_tokens,
        trigger="interval",
        hours=6,
        id="auto_refresh_expiring_tokens",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        func=prune_storage_job,
        trigger="interval",
        hours=24,
        id="prune_storage_job",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        func=refresh_social_insights_job,
        trigger="interval",
        seconds=core.SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS,
        id="refresh_social_insights",
        replace_existing=True,
        max_instances=1,
        next_run_time=utcnow() + timedelta(seconds=core.SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS),
    )
    scheduler.start()
    logger.info("Scheduler started. Timezone=%s", APP_TIMEZONE_NAME)
