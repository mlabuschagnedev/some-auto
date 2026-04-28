from __future__ import annotations

from . import app as core

Any = core.Any
Path = core.Path
UniqueConstraint = core.UniqueConstraint
db = core.db
effective_planning_month_for_row = core.effective_planning_month_for_row
func = core.func
inspect = core.inspect
json = core.json
json_loads_safe = core.json_loads_safe
normalize_planning_month = core.normalize_planning_month
normalize_timezone_name = core.normalize_timezone_name
planning_month_label = core.planning_month_label
text = core.text
utcnow = core.utcnow
DEFAULT_SETTINGS = core.DEFAULT_SETTINGS
APP_TIMEZONE_NAME = core.APP_TIMEZONE_NAME

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="admin")
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
        }


class Page(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    image_path = db.Column(db.String(255), nullable=True)
    linkedin_page_url = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    social_accounts = db.relationship(
        "SocialAccount", backref="page", lazy=True, cascade="all, delete-orphan"
    )
    posts = db.relationship("Post", backref="page", lazy=True, cascade="all, delete-orphan")
    planning_sheet = db.relationship(
        "PlanningSheet",
        backref="page",
        uselist=False,
        lazy=True,
        cascade="all, delete-orphan",
    )

    def to_dict(self, stats: dict[str, int] | None = None, include_accounts: bool = True) -> dict[str, Any]:
        if stats is None:
            successful_posts = Post.query.filter_by(page_id=self.id, status="posted").count()
            failed_posts = Post.query.filter_by(page_id=self.id, status="failed").count()
            scheduled_posts = (
                Post.query.filter(
                    Post.page_id == self.id,
                    Post.status.in_(["scheduled", "posting", "manual_pending", "draft"]),
                ).count()
            )
            stats = {
                "successful_posts": successful_posts,
                "failed_posts": failed_posts,
                "scheduled_posts": scheduled_posts,
            }

        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "image_path": self.image_path,
            "linkedin_page_url": self.linkedin_page_url,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "social_accounts": [account.to_dict() for account in self.social_accounts] if include_accounts else [],
            "stats": stats,
        }


class SocialAccount(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    page_id = db.Column(db.Integer, db.ForeignKey("page.id"), nullable=False)
    platform = db.Column(db.String(50), nullable=False)
    account_name = db.Column(db.String(100), nullable=True)

    access_token = db.Column(db.Text, nullable=True)
    access_token_secret = db.Column(db.Text, nullable=True)
    api_key = db.Column(db.Text, nullable=True)
    api_secret = db.Column(db.Text, nullable=True)
    refresh_token = db.Column(db.Text, nullable=True)
    page_id_external = db.Column(db.String(100), nullable=True)

    token_expires_at = db.Column(db.DateTime, nullable=True)
    last_refreshed = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    last_tested = db.Column(db.DateTime, nullable=True)
    test_status = db.Column(db.String(20), nullable=True)
    test_error = db.Column(db.Text, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "page_id": self.page_id,
            "platform": self.platform,
            "account_name": self.account_name,
            "page_id_external": self.page_id_external,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
            "last_tested": self.last_tested.isoformat() if self.last_tested else None,
            "test_status": self.test_status,
            "test_error": self.test_error,
            "token_expires_at": self.token_expires_at.isoformat() if self.token_expires_at else None,
            "last_refreshed": self.last_refreshed.isoformat() if self.last_refreshed else None,
        }


class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    page_id = db.Column(db.Integer, db.ForeignKey("page.id"), nullable=False)
    content = db.Column(db.Text, nullable=True)

    media_paths = db.Column(db.Text, nullable=True)
    media_type = db.Column(db.String(20), nullable=True)
    platforms = db.Column(db.Text, nullable=True)

    scheduled_time = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default="draft", nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    posted_at = db.Column(db.DateTime, nullable=True)
    error_message = db.Column(db.Text, nullable=True)

    facebook_post_id = db.Column(db.String(100), nullable=True)
    instagram_post_id = db.Column(db.String(100), nullable=True)
    linkedin_post_id = db.Column(db.String(100), nullable=True)
    twitter_post_id = db.Column(db.String(100), nullable=True)
    pinterest_post_id = db.Column(db.String(100), nullable=True)
    platform_post_urls = db.Column(db.Text, nullable=True)
    linkedin_manual_done_at = db.Column(db.DateTime, nullable=True)
    linkedin_manual_done_by = db.Column(db.String(120), nullable=True)

    def media_list(self) -> list[str]:
        return json_loads_safe(self.media_paths, [])

    def platform_list(self) -> list[str]:
        return json_loads_safe(self.platforms, [])

    def platform_url_map(self) -> dict[str, str]:
        items = json_loads_safe(self.platform_post_urls, {})
        if not isinstance(items, dict):
            return {}
        return {str(key): str(value) for key, value in items.items() if str(value).strip()}

    def requires_linkedin_manual_assist(self) -> bool:
        return "linkedin" in self.platform_list()

    def linkedin_manual_payload(self) -> dict[str, Any]:
        from .media import build_local_media_url, is_video_path

        if not self.requires_linkedin_manual_assist():
            return {"required": False}

        media_items = [
            {
                "path": media_path,
                "name": Path(media_path).name,
                "url": build_local_media_url(media_path),
                "is_video": is_video_path(media_path),
            }
            for media_path in self.media_list()
        ]
        return {
            "required": True,
            "done": bool(self.linkedin_manual_done_at),
            "done_at": self.linkedin_manual_done_at.isoformat() if self.linkedin_manual_done_at else None,
            "done_by": self.linkedin_manual_done_by,
            "page_url": self.page.linkedin_page_url if self.page else None,
            "media_items": media_items,
        }

    def to_dict(self) -> dict[str, Any]:
        from .publishing import build_post_platform_urls

        return {
            "id": self.id,
            "page_id": self.page_id,
            "page_name": self.page.name if self.page else None,
            "content": self.content,
            "media_paths": self.media_list(),
            "media_type": self.media_type,
            "platforms": self.platform_list(),
            "scheduled_time": self.scheduled_time.isoformat() if self.scheduled_time else None,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "posted_at": self.posted_at.isoformat() if self.posted_at else None,
            "error_message": self.error_message,
            "platform_ids": {
                "facebook": self.facebook_post_id,
                "instagram": self.instagram_post_id,
                "linkedin": self.linkedin_post_id,
                "twitter": self.twitter_post_id,
                "pinterest": self.pinterest_post_id,
            },
            "platform_urls": build_post_platform_urls(self),
            "linkedin_manual": self.linkedin_manual_payload(),
        }


class AppSetting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    @staticmethod
    def get_setting(key: str, default: str | None = None) -> str | None:
        setting = AppSetting.query.filter_by(key=key).first()
        return setting.value if setting else default

    @staticmethod
    def set_setting(key: str, value: str, commit: bool = True) -> None:
        setting = AppSetting.query.filter_by(key=key).first()
        if setting:
            setting.value = value
        else:
            db.session.add(AppSetting(key=key, value=value))
        if commit:
            db.session.commit()

    @staticmethod
    def get_many(keys: set[str] | list[str]) -> dict[str, str]:
        rows = AppSetting.query.filter(AppSetting.key.in_(list(keys))).all()
        return {row.key: row.value for row in rows}


class PageSetting(db.Model):
    __table_args__ = (UniqueConstraint("page_id", "key", name="uq_page_settings_page_key"),)

    id = db.Column(db.Integer, primary_key=True)
    page_id = db.Column(db.Integer, db.ForeignKey("page.id"), nullable=False, index=True)
    key = db.Column(db.String(100), nullable=False)
    value = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    @staticmethod
    def get_setting(page_id: int, key: str, default: str | None = None) -> str | None:
        setting = PageSetting.query.filter_by(page_id=page_id, key=key).first()
        return setting.value if setting else default

    @staticmethod
    def set_setting(page_id: int, key: str, value: str, commit: bool = True) -> None:
        setting = PageSetting.query.filter_by(page_id=page_id, key=key).first()
        if setting:
            setting.value = value
        else:
            db.session.add(PageSetting(page_id=page_id, key=key, value=value))
        if commit:
            db.session.commit()

    @staticmethod
    def get_many(page_id: int, keys: set[str] | list[str]) -> dict[str, str]:
        rows = PageSetting.query.filter(
            PageSetting.page_id == page_id,
            PageSetting.key.in_(list(keys)),
        ).all()
        return {row.key: row.value for row in rows}


class PlanningSheet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    page_id = db.Column(db.Integer, db.ForeignKey("page.id"), nullable=False, unique=True, index=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    rows = db.relationship(
        "PlanningRow",
        backref="sheet",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="PlanningRow.row_order.asc()",
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "page_id": self.page_id,
            "page_name": self.page.name if self.page else None,
            "row_count": len(self.rows),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class PlanningRow(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sheet_id = db.Column(db.Integer, db.ForeignKey("planning_sheet.id"), nullable=False, index=True)
    row_order = db.Column(db.Integer, nullable=False, default=0, index=True)
    planning_month = db.Column(db.String(7), nullable=True, index=True)
    is_non_actionable = db.Column(db.Boolean, nullable=False, default=False)

    linked_accounts = db.Column(db.Text, nullable=True)
    job_nr = db.Column(db.String(120), nullable=True)
    job_color = db.Column(db.String(7), nullable=False, default="#D9D9D9")
    date_value = db.Column(db.String(80), nullable=True)
    time_value = db.Column(db.String(40), nullable=True)
    theme = db.Column(db.Text, nullable=True)
    post_copy = db.Column(db.Text, nullable=True)
    link = db.Column(db.Text, nullable=True)
    format = db.Column(db.String(120), nullable=True)
    final_creative = db.Column(db.Text, nullable=True)
    deadline = db.Column(db.String(80), nullable=True)
    mss_notes = db.Column(db.Text, nullable=True)
    creative_media_path = db.Column(db.String(255), nullable=True)
    creative_media_paths = db.Column(db.Text, nullable=True)
    designer = db.Column(db.String(120), nullable=True)
    designer_warning_key = db.Column(db.String(64), nullable=True)
    designer_warning_sent_at = db.Column(db.DateTime, nullable=True)
    Reviewer_warning_key = db.Column(db.String(64), nullable=True)
    Reviewer_warning_sent_at = db.Column(db.DateTime, nullable=True)
    ready_warning_key = db.Column(db.String(64), nullable=True)
    ready_warning_sent_at = db.Column(db.DateTime, nullable=True)

    scheduled_post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    def creative_media_list(self) -> list[str]:
        items = json_loads_safe(self.creative_media_paths, [])
        if isinstance(items, list):
            normalized = [str(item).strip() for item in items if str(item).strip()]
            if normalized:
                return normalized
        if self.creative_media_path:
            return [self.creative_media_path]
        return []

    def set_creative_media(self, items: list[str]) -> None:
        normalized = [str(item).strip() for item in items if str(item).strip()]
        self.creative_media_paths = json.dumps(normalized) if normalized else None
        self.creative_media_path = normalized[0] if normalized else None

    def to_dict(self) -> dict[str, Any]:
        media_items = self.creative_media_list()
        media_urls = [
            item if item.startswith(("http://", "https://", "/")) else f"/uploads/{item}"
            for item in media_items
        ]
        planning_month = effective_planning_month_for_row(self)
        return {
            "id": self.id,
            "sheet_id": self.sheet_id,
            "page_id": self.sheet.page_id if self.sheet else None,
            "row_order": self.row_order,
            "planning_month": planning_month,
            "planning_month_label": planning_month_label(planning_month),
            "is_non_actionable": bool(self.is_non_actionable),
            "linked_accounts": self.linked_accounts or "",
            "job_nr": self.job_nr or "",
            "job_color": (self.job_color or "#D9D9D9").upper(),
            "date_value": self.date_value or "",
            "time_value": self.time_value or "",
            "theme": self.theme or "",
            "post_copy": self.post_copy or "",
            "link": self.link or "",
            "format": self.format or "",
            "final_creative": self.final_creative or "",
            "deadline": self.deadline or "",
            "mss_notes": self.mss_notes or "",
            "creative_media_path": media_items[0] if media_items else "",
            "creative_media_url": media_urls[0] if media_urls else None,
            "creative_media_paths": media_items,
            "creative_media_urls": media_urls,
            "creative_media_count": len(media_items),
            "designer": self.designer or "",
            "designer_warning_sent_at": self.designer_warning_sent_at.isoformat() if self.designer_warning_sent_at else None,
            "Reviewer_warning_sent_at": self.Reviewer_warning_sent_at.isoformat() if self.Reviewer_warning_sent_at else None,
            "ready_warning_sent_at": self.ready_warning_sent_at.isoformat() if self.ready_warning_sent_at else None,
            "scheduled_post_id": self.scheduled_post_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


def seed_defaults() -> None:
    for key, value in DEFAULT_SETTINGS.items():
        if not AppSetting.query.filter_by(key=key).first():
            db.session.add(AppSetting(key=key, value=value))

    timezone_setting = AppSetting.query.filter_by(key="timezone").first()
    if timezone_setting:
        normalized = normalize_timezone_name(timezone_setting.value)
        timezone_setting.value = normalized or APP_TIMEZONE_NAME

    page_timezone_settings = PageSetting.query.filter_by(key="timezone").all()
    for page_setting in page_timezone_settings:
        normalized = normalize_timezone_name(page_setting.value)
        page_setting.value = normalized or APP_TIMEZONE_NAME

    db.session.commit()


def seed_planning_sheets() -> None:
    pages = Page.query.all()
    changed = False
    for page in pages:
        existing = PlanningSheet.query.filter_by(page_id=page.id).first()
        if existing:
            continue
        db.session.add(PlanningSheet(page_id=page.id))
        changed = True
    if changed:
        db.session.commit()


def ensure_runtime_schema() -> None:
    inspector = inspect(db.engine)
    if inspector.has_table("page"):
        page_columns = {column["name"] for column in inspector.get_columns("page")}
        if "linkedin_page_url" not in page_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE page ADD COLUMN linkedin_page_url VARCHAR(500)"))

    if inspector.has_table("post"):
        post_columns = {column["name"] for column in inspector.get_columns("post")}
        if "platform_post_urls" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN platform_post_urls TEXT"))
        if "linkedin_manual_done_at" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN linkedin_manual_done_at DATETIME"))
        if "linkedin_manual_done_by" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN linkedin_manual_done_by VARCHAR(120)"))

    if not inspector.has_table("planning_row"):
        return

    columns = {column["name"] for column in inspector.get_columns("planning_row")}
    if "planning_month" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN planning_month VARCHAR(7)"))
    if "is_non_actionable" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN is_non_actionable BOOLEAN NOT NULL DEFAULT 0"))
    if "creative_media_paths" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN creative_media_paths TEXT"))
    if "designer_warning_key" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN designer_warning_key VARCHAR(64)"))
    if "designer_warning_sent_at" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN designer_warning_sent_at DATETIME"))
    if "Reviewer_warning_key" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN Reviewer_warning_key VARCHAR(64)"))
    if "Reviewer_warning_sent_at" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN Reviewer_warning_sent_at DATETIME"))
    if "ready_warning_key" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN ready_warning_key VARCHAR(64)"))
    if "ready_warning_sent_at" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN ready_warning_sent_at DATETIME"))

    rows_needing_month = PlanningRow.query.all()
    changed = False
    for row in rows_needing_month:
        resolved = effective_planning_month_for_row(row)
        if normalize_planning_month(row.planning_month) != resolved:
            row.planning_month = resolved
            changed = True
    if changed:
        db.session.commit()

def build_page_stats_map(page_ids: list[int]) -> dict[int, dict[str, int]]:
    stats: dict[int, dict[str, int]] = {
        page_id: {"successful_posts": 0, "failed_posts": 0, "scheduled_posts": 0} for page_id in page_ids
    }
    if not page_ids:
        return stats

    rows = (
        db.session.query(Post.page_id, Post.status, func.count(Post.id))
        .filter(Post.page_id.in_(page_ids))
        .filter(Post.status.in_(["posted", "failed", "scheduled", "posting", "manual_pending", "draft"]))
        .group_by(Post.page_id, Post.status)
        .all()
    )
    for page_id, status, count in rows:
        if status == "posted":
            stats[page_id]["successful_posts"] = int(count)
        elif status == "failed":
            stats[page_id]["failed_posts"] = int(count)
        elif status in {"scheduled", "posting", "manual_pending", "draft"}:
            stats[page_id]["scheduled_posts"] += int(count)
    return stats

