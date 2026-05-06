"""
MSS SoME-Auto - Backend API
Clean Flask backend for local social media scheduling and publishing workflows.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from functools import wraps
from html import escape
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import re
import socket
import smtplib
import ssl
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:  # pragma: no cover - optional import fallback
    service_account = None
    build = None
    HttpError = None
from PIL import Image
import requests
from flask import Flask, jsonify, has_app_context, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, func, inspect, text
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.exc import StaleDataError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

try:
    from requests_oauthlib import OAuth1
except ImportError:  # pragma: no cover - optional import fallback
    OAuth1 = None


# -------------------------
# App setup
# -------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = Path(os.environ.get("INSTANCE_DIR", str(BASE_DIR / "instance"))).resolve()
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(BASE_DIR / "uploads"))).resolve()
IMAGE_DIR = UPLOAD_DIR / "images"
VIDEO_DIR = UPLOAD_DIR / "videos"
PLANNING_IMPORT_DIR = Path(os.environ.get("PLANNING_IMPORT_DIR", str(BASE_DIR / "imports" / "planning"))).resolve()
PLANNING_IMPORT_INBOX_DIR = PLANNING_IMPORT_DIR / "inbox"
PLANNING_IMPORT_PROCESSED_DIR = PLANNING_IMPORT_DIR / "processed"
RUNTIME_DIR = BASE_DIR / "runtime"
CLOUDFLARED_AUTO_LOG_PATH = RUNTIME_DIR / "cloudflared-auto.log"
MEDIA_URL_SIGNING_SECRET_FILE = INSTANCE_DIR / "media_url_signing_secret.txt"
TRYCLOUDFLARE_URL_REGEX = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
SUPPORTED_PLATFORMS = {"facebook", "instagram", "linkedin", "twitter", "pinterest"}
INSTAGRAM_IMAGE_RATIO_MIN = 4 / 5
INSTAGRAM_IMAGE_RATIO_MAX = 1.91
INSTAGRAM_RATIO_EPSILON = 0.01
API_TIMEOUT_SECONDS = int(os.environ.get("API_TIMEOUT_SECONDS", "30"))
PUBLIC_MEDIA_URL_TTL_SECONDS = int(os.environ.get("PUBLIC_MEDIA_URL_TTL_SECONDS", "86400"))
APP_TIMEZONE_NAME = os.environ.get("APP_TIMEZONE", "Africa/Johannesburg")
APP_TIMEZONE = ZoneInfo(APP_TIMEZONE_NAME)
USERS_FILE = Path(os.environ.get("USERS_FILE", str(INSTANCE_DIR / "users.json"))).resolve()
TIMEZONE_ALIASES = {
    "UTC": "Africa/Johannesburg",
    "GMT+2": "Africa/Johannesburg",
    "UTC+2": "Africa/Johannesburg",
    "SAST": "Africa/Johannesburg",
    "AFRICA/JOHANNESBURG": "Africa/Johannesburg",
}

DEFAULT_SETTINGS = {
    "app_name": "MSS SoME-Auto",
    "default_post_time": "10:00",
    "timezone": APP_TIMEZONE_NAME,
    "auto_schedule": "true",
    "notification_enabled": "true",
    "live_posting_enabled": "false",
}
GLOBAL_SETTING_KEYS = set(DEFAULT_SETTINGS.keys())
GLOBAL_META_USER_TOKEN_KEY = "global_meta_user_token"
LEGACY_META_GLOBAL_USER_TOKEN_KEY = "meta_global_user_token"
DESIGNER_EMAIL_MAP_KEY = "designer_email_map"
FACEBOOK_APP_ID_SETTING_KEY = "facebook_app_id"
FACEBOOK_APP_SECRET_SETTING_KEY = "facebook_app_secret"
META_GLOBAL_TOKEN_EXPIRES_AT_KEY = "meta_global_token_expires_at"
META_GLOBAL_LAST_REFRESHED_KEY = "meta_global_last_refreshed"
META_GLOBAL_LAST_CHECKED_KEY = "meta_global_last_checked"
META_GLOBAL_EXPIRY_ASSUMED_KEY = "meta_global_expiry_assumed"
GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY = "global_linkedin_access_token"
GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY = "global_linkedin_refresh_token"
GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY = "global_linkedin_token_expires_at"
GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY = "global_linkedin_refresh_token_expires_at"
GLOBAL_LINKEDIN_LAST_REFRESHED_KEY = "global_linkedin_last_refreshed"
GLOBAL_LINKEDIN_LAST_CHECKED_KEY = "global_linkedin_last_checked"
GLOBAL_LINKEDIN_MEMBER_URN_KEY = "global_linkedin_member_urn"
GLOBAL_LINKEDIN_MEMBER_NAME_KEY = "global_linkedin_member_name"
GLOBAL_LINKEDIN_SCOPES_KEY = "global_linkedin_scopes"
META_GLOBAL_WARNING_DAYS = 3
META_GLOBAL_ASSUMED_LIFETIME_DAYS = 50
LINKEDIN_GLOBAL_WARNING_DAYS = 3
LINKEDIN_API_VERSION = os.environ.get("LINKEDIN_API_VERSION", "202602").strip() or "202602"
MONTHLY_INSIGHTS_META_API_VERSION = os.environ.get("MONTHLY_INSIGHTS_META_API_VERSION", "v24.0").strip() or "v24.0"
LINKEDIN_ALLOWED_ORG_POST_ROLES = {
    "ADMINISTRATOR",
    "DIRECT_SPONSORED_CONTENT_POSTER",
    "CONTENT_ADMINISTRATOR",
    "CONTENT_ADMIN",
}
MONTHLY_INSIGHTS_SPREADSHEET_KEY = "monthly_insights_spreadsheet"
MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY = "monthly_insights_google_service_account_json"
MONTHLY_INSIGHTS_META_API_VERSION_KEY = "monthly_insights_meta_api_version"
GOOGLE_SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
MONTHLY_SHEET_SECTION_HEADERS = {
    "socialmedia",
    "facebook",
    "instagram",
    "linkedin",
    "googlebusinessprofile",
    "postcontent",
    "designposts",
    "imageposts",
}
FACEBOOK_SHEET_METRIC_ROW_ALIASES = {
    "views": {"views"},
    "reach": {"reach"},
    "interactions": {"interactions", "reactions"},
    "visits": {"visits", "pageviews", "profileviews"},
    "followers": {"followers", "follows"},
}
INSTAGRAM_SHEET_METRIC_ROW_ALIASES = {
    "views": {"views"},
    "reach": {"reach"},
    "interactions": {"interactions", "reactions"},
    "visits": {"visits", "profileviews"},
    "followers": {"followers", "follows"},
}
FACEBOOK_MONTHLY_METRIC_CANDIDATES = {
    "views": ["views", "page_impressions"],
    "reach": ["reach", "page_impressions_unique", "page_reach_total"],
    "interactions": ["content_interactions", "page_post_engagements", "page_engaged_users"],
    "visits": ["visits", "page_views_total"],
}
INSTAGRAM_MONTHLY_METRIC_CANDIDATES = {
    "views": ["views", "impressions"],
    "reach": ["reach"],
    "interactions": ["total_interactions", "accounts_engaged", "engagement"],
    "visits": ["profile_views"],
}
FACEBOOK_FOLLOWER_FIELD_CANDIDATES = ["followers_count", "fan_count"]
INSTAGRAM_FOLLOWER_FIELD_CANDIDATES = ["followers_count"]
GLOBAL_WRITABLE_SETTING_KEYS = GLOBAL_SETTING_KEYS | {
    GLOBAL_META_USER_TOKEN_KEY,
    LEGACY_META_GLOBAL_USER_TOKEN_KEY,
    DESIGNER_EMAIL_MAP_KEY,
    FACEBOOK_APP_ID_SETTING_KEY,
    FACEBOOK_APP_SECRET_SETTING_KEY,
    GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY,
    GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY,
    GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY,
    GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY,
    MONTHLY_INSIGHTS_SPREADSHEET_KEY,
    MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY,
    MONTHLY_INSIGHTS_META_API_VERSION_KEY,
}
PAGE_OVERRIDEABLE_SETTING_KEYS = {
    "default_post_time",
    "timezone",
    "auto_schedule",
    "notification_enabled",
    "live_posting_enabled",
}
PAGE_REFERENCE_SHEET_DEFINITIONS = {
    "sheet_one": {"setting_key": "page_reference_sheet_one_json", "default_title": "Info Sheet 1"},
    "sheet_two": {"setting_key": "page_reference_sheet_two_json", "default_title": "Info Sheet 2"},
}
GLOBAL_REFERENCE_SHEET_DEFINITIONS = {
    "contact_info": {"setting_key": "global_contact_info_sheet_json", "default_title": "Contact info"},
    "login_details": {"setting_key": "global_login_details_sheet_json", "default_title": "Login details"},
}
PAGE_REFERENCE_SHEET_DEFAULT_COLUMN_COUNT = 5
PAGE_REFERENCE_SHEET_DEFAULT_ROW_COUNT = 8
PAGE_REFERENCE_SHEET_MAX_COLUMNS = 20
PAGE_REFERENCE_SHEET_MAX_ROWS = 120
PAGE_REFERENCE_SHEET_MAX_TITLE_LENGTH = 120
PAGE_REFERENCE_SHEET_MAX_LABEL_LENGTH = 80
PAGE_REFERENCE_SHEET_MAX_CELL_HTML_LENGTH = 20000
USER_ROLES = {"developer", "admin", "designer"}
PRIMARY_DEVELOPER_USERNAME = (os.environ.get("PRIMARY_DEVELOPER_USERNAME", "marcel").strip() or "marcel").lower()
PRIMARY_DEVELOPER_DISPLAY_NAME = (
    os.environ.get("PRIMARY_DEVELOPER_DISPLAY_NAME", "Marcel").strip() or PRIMARY_DEVELOPER_USERNAME
)
PRIMARY_DEVELOPER_EMAIL = os.environ.get("PRIMARY_DEVELOPER_EMAIL", "marcel@marketingss.co.za").strip() or None
PRIMARY_DEVELOPER_PASSWORD = os.environ.get("PRIMARY_DEVELOPER_PASSWORD", "admin123")
ROLE_TABS = {
    "developer": ["pages", "scheduled", "posted", "planning", "settings", "integrations"],
    "admin": ["pages", "scheduled", "posted", "planning"],
    "designer": ["scheduled", "posted", "planning"],
}
PLANNING_READY_COLOR = "#34A853"
PLANNING_CLARISE_SENT_COLOR = "#137333"
PLANNING_SCHEDULED_COLOR = "#0B57D0"
PLANNING_POSTED_COLOR = "#666666"
PLANNING_FAILED_COLOR = "#000000"
FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES = 25
# The scheduler runs every 30 seconds, so pull approved planning rows into the
# scheduled queue shortly before their target time.
PLANNING_AUTO_SCHEDULE_LEAD_MINUTES = FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES + 1
PLANNING_WARNING_LEAD_HOURS = 24
PLANNING_READY_WARNING_LEAD_HOURS = 2
PLANNING_CLARISE_REQUIRED_FIELDS = {
    "theme": "Theme",
    "post_copy": "Post Copy",
    "format": "Format",
    "final_creative": "Final Creative",
}
EMAIL_TO = [
    email.strip()
    for email in os.environ.get("EMAIL_TO", "").split(",")
    if email.strip()
]
EMAIL_FROM = os.environ.get("EMAIL_FROM", "marcel@marketingss.co.za").strip()
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.marketingss.co.za").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "marcel@marketingss.co.za").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "Eaveplay123!@#",)
SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "ssl").strip().lower()
SMTP_DEBUG = os.environ.get("SMTP_DEBUG", "0").strip().lower() in {"1", "true", "yes", "on"}
SMTP_TRY_FALLBACK = os.environ.get("SMTP_TRY_FALLBACK", "1").strip().lower() in {"1", "true", "yes", "on"}

if not EMAIL_FROM and SMTP_USER:
    EMAIL_FROM = SMTP_USER


def utcnow() -> datetime:
    # Keep stored naive datetimes consistently in configured local timezone.
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"

    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is not None:
        dt = dt.astimezone(APP_TIMEZONE).replace(tzinfo=None)
    return dt


def normalize_timezone_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    alias = TIMEZONE_ALIASES.get(cleaned.upper())
    if alias:
        return alias
    try:
        ZoneInfo(cleaned)
    except Exception:
        return None
    return cleaned


def json_loads_safe(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def current_planning_month_key() -> str:
    return utcnow().strftime("%Y-%m")


def normalize_planning_month(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    try:
        return datetime.strptime(cleaned, "%Y-%m").strftime("%Y-%m")
    except ValueError:
        return None


def planning_month_label(month_key: str | None) -> str | None:
    normalized = normalize_planning_month(month_key)
    if not normalized:
        return None
    return datetime.strptime(normalized, "%Y-%m").strftime("%B %Y")


def planning_month_is_past(month_key: str | None) -> bool:
    normalized = normalize_planning_month(month_key)
    if not normalized:
        return False
    return normalized < current_planning_month_key()


def planning_month_from_date(parsed_date: date | None) -> str | None:
    if parsed_date is None:
        return None
    return parsed_date.strftime("%Y-%m")


def shift_planning_month(month_key: str, delta: int) -> str:
    normalized = normalize_planning_month(month_key) or current_planning_month_key()
    parsed = datetime.strptime(normalized, "%Y-%m")
    month_index = (parsed.year * 12 + (parsed.month - 1)) + delta
    year = month_index // 12
    month = month_index % 12 + 1
    return f"{year:04d}-{month:02d}"


def iter_planning_month_keys(start_month: str, end_month: str) -> list[str]:
    start = normalize_planning_month(start_month) or current_planning_month_key()
    end = normalize_planning_month(end_month) or start
    if start > end:
        start, end = end, start
    items: list[str] = []
    cursor = start
    while cursor <= end:
        items.append(cursor)
        cursor = shift_planning_month(cursor, 1)
    return items


def parse_planning_date_value(date_value: str | None) -> date | None:
    raw_date = (date_value or "").strip()
    if not raw_date:
        return None

    date_formats = [
        ("%Y-%m-%d", True),
        ("%d/%m/%Y", True),
        ("%d-%m-%Y", True),
        ("%a, %d %B", False),
        ("%A, %d %B", False),
        ("%d %B", False),
    ]
    current_year = utcnow().year
    for fmt, has_year in date_formats:
        try:
            parsed = datetime.strptime(raw_date, fmt)
            year = parsed.year if has_year else current_year
            return parsed.replace(year=year).date()
        except ValueError:
            continue
    return None


def effective_planning_month_for_row(row: "PlanningRow") -> str:
    normalized = normalize_planning_month(getattr(row, "planning_month", None))
    if normalized:
        return normalized
    from_date = planning_month_from_date(parse_planning_date_value(getattr(row, "date_value", None)))
    if from_date:
        return from_date
    created_at = getattr(row, "created_at", None) or utcnow()
    return created_at.strftime("%Y-%m")


@dataclass
class AuthUser:
    username: str
    email: str | None
    display_name: str | None
    role: str
    is_active: bool = True

    @property
    def is_owner(self) -> bool:
        return is_primary_developer_username(self.username)

    def to_dict(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name or self.username,
            "role": self.role,
            "is_active": self.is_active,
            "is_owner": self.is_owner,
            "available_tabs": ROLE_TABS.get(self.role, []),
        }


def default_user_store_payload() -> dict[str, Any]:
    return {
        "users": [
            {
                "username": PRIMARY_DEVELOPER_USERNAME,
                "display_name": PRIMARY_DEVELOPER_DISPLAY_NAME,
                "email": PRIMARY_DEVELOPER_EMAIL,
                "role": "developer",
                "is_active": True,
                "password_hash": generate_password_hash(PRIMARY_DEVELOPER_PASSWORD),
            },
        ]
    }


def save_user_store(payload: dict[str, Any]) -> None:
    USERS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def normalize_username(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_display_name(value: str | None, username: str) -> str:
    cleaned = str(value or "").strip()
    return cleaned or username


def is_primary_developer_username(username: str | None) -> bool:
    return normalize_username(username) == PRIMARY_DEVELOPER_USERNAME


def validate_username(username: str) -> None:
    if len(username) < 3 or len(username) > 64:
        raise ValueError("Username must be between 3 and 64 characters.")
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    if any(char not in allowed for char in username):
        raise ValueError("Username may only contain lowercase letters, numbers, dots, underscores, and hyphens.")


def build_auth_user(record: dict[str, Any]) -> AuthUser:
    record_username = str(record.get("username") or "").strip()
    role = str(record.get("role") or "").strip().lower()
    if not record_username:
        raise RuntimeError("User records must include a username.")
    if role not in USER_ROLES:
        raise RuntimeError(f"Unsupported role '{role}' in users file for {record_username}.")
    return AuthUser(
        username=record_username,
        email=str(record.get("email") or "").strip() or None,
        display_name=normalize_display_name(record.get("display_name"), record_username),
        role=role,
        is_active=bool(record.get("is_active", True)),
    )


def serialize_user_record(record: dict[str, Any]) -> dict[str, Any]:
    payload = build_auth_user(record).to_dict()
    payload["has_password"] = bool(str(record.get("password_hash") or "").strip())
    return payload


def ensure_primary_developer_user(payload: dict[str, Any]) -> bool:
    users = payload.setdefault("users", [])
    if not isinstance(users, list):
        raise RuntimeError("User store must contain a 'users' array.")

    for record in users:
        if not isinstance(record, dict):
            continue
        if not is_primary_developer_username(record.get("username")):
            continue

        changed = False
        if str(record.get("role") or "").strip().lower() != "developer":
            record["role"] = "developer"
            changed = True
        if not bool(record.get("is_active", True)):
            record["is_active"] = True
            changed = True
        if not str(record.get("display_name") or "").strip():
            record["display_name"] = PRIMARY_DEVELOPER_DISPLAY_NAME
            changed = True
        if not str(record.get("password_hash") or "").strip():
            record["password_hash"] = generate_password_hash(PRIMARY_DEVELOPER_PASSWORD)
            changed = True
        return changed

    users.insert(0, default_user_store_payload()["users"][0])
    return True


def ensure_user_store_file() -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if USERS_FILE.exists():
        return
    save_user_store(default_user_store_payload())


def load_user_store() -> dict[str, Any]:
    ensure_user_store_file()
    try:
        payload = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Unable to read user store: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("User store must be a JSON object.")
    users = payload.get("users")
    if not isinstance(users, list):
        raise RuntimeError("User store must contain a 'users' array.")
    if ensure_primary_developer_user(payload):
        save_user_store(payload)
    return payload


def list_auth_users() -> list[AuthUser]:
    payload = load_user_store()
    users: list[AuthUser] = []
    for record in payload.get("users", []):
        if not isinstance(record, dict):
            continue
        users.append(build_auth_user(record))
    return users


def sorted_user_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def sort_key(record: dict[str, Any]) -> tuple[int, str, str]:
        user = build_auth_user(record)
        return (
            0 if user.is_active else 1,
            0 if user.role == "developer" else 1 if user.role == "admin" else 2,
            (user.display_name or user.username).casefold(),
        )

    return sorted(records, key=sort_key)


def validate_designer_label_uniqueness(
    records: list[dict[str, Any]],
    *,
    username: str,
    role: str,
    display_name: str | None,
) -> None:
    if role != "designer":
        return

    candidate_label = normalize_display_name(display_name, username).casefold()
    for record in records:
        if not isinstance(record, dict):
            continue
        existing_user = build_auth_user(record)
        if normalize_username(existing_user.username) == username:
            continue
        if existing_user.role != "designer":
            continue
        if designer_label_for_user(existing_user).casefold() == candidate_label:
            raise ValueError("Designer display names must be unique among designer users.")


def find_auth_user(username: str) -> tuple[AuthUser, dict[str, Any]] | tuple[None, None]:
    payload = load_user_store()
    target = normalize_username(username)
    for record in payload.get("users", []):
        if not isinstance(record, dict):
            continue
        record_username = normalize_username(record.get("username"))
        if record_username != target:
            continue
        return build_auth_user(record), record
    return None, None


app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", f"sqlite:///{(INSTANCE_DIR / 'social_media_manager.db').as_posix()}"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(minutes=30)
app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=7)

jwt_secret = os.environ.get("JWT_SECRET_KEY")
if not jwt_secret:
    jwt_secret = os.urandom(32).hex()
    print("[WARNING] JWT_SECRET_KEY not set; using an ephemeral secret for this run.")
app.config["JWT_SECRET_KEY"] = jwt_secret

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5000",
                "http://127.0.0.1:5000",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]
        }
    },
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mss-some-auto")

_local_media_signing_secret: str | None = None
META_USER_TOKEN_CACHE: dict[str, dict[str, Any]] = {}

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
PLANNING_IMPORT_INBOX_DIR.mkdir(parents=True, exist_ok=True)
PLANNING_IMPORT_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "instance").mkdir(parents=True, exist_ok=True)
ensure_user_store_file()

db = SQLAlchemy(app)
jwt = JWTManager(app)
scheduler = BackgroundScheduler(timezone=APP_TIMEZONE_NAME)


# -------------------------
# Database models
# -------------------------


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
    facebook_remote_post_id = db.Column(db.String(100), nullable=True)
    facebook_remote_state = db.Column(db.String(40), nullable=True)
    facebook_remote_scheduled_time = db.Column(db.DateTime, nullable=True)
    facebook_remote_last_error = db.Column(db.Text, nullable=True)
    facebook_remote_synced_at = db.Column(db.DateTime, nullable=True)
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
            "facebook_remote": {
                "post_id": self.facebook_remote_post_id,
                "state": self.facebook_remote_state,
                "scheduled_time": self.facebook_remote_scheduled_time.isoformat() if self.facebook_remote_scheduled_time else None,
                "last_error": self.facebook_remote_last_error,
                "synced_at": self.facebook_remote_synced_at.isoformat() if self.facebook_remote_synced_at else None,
            },
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
    clarise_warning_key = db.Column(db.String(64), nullable=True)
    clarise_warning_sent_at = db.Column(db.DateTime, nullable=True)
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
            "clarise_warning_sent_at": self.clarise_warning_sent_at.isoformat() if self.clarise_warning_sent_at else None,
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
        if "facebook_remote_post_id" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN facebook_remote_post_id VARCHAR(100)"))
        if "facebook_remote_state" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN facebook_remote_state VARCHAR(40)"))
        if "facebook_remote_scheduled_time" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN facebook_remote_scheduled_time DATETIME"))
        if "facebook_remote_last_error" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN facebook_remote_last_error TEXT"))
        if "facebook_remote_synced_at" not in post_columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE post ADD COLUMN facebook_remote_synced_at DATETIME"))
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
    if "clarise_warning_key" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN clarise_warning_key VARCHAR(64)"))
    if "clarise_warning_sent_at" not in columns:
        with db.engine.begin() as connection:
            connection.execute(text("ALTER TABLE planning_row ADD COLUMN clarise_warning_sent_at DATETIME"))
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


with app.app_context():
    db.create_all()
    ensure_runtime_schema()
    seed_defaults()
    seed_planning_sheets()


def get_json_body() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


def parse_bool_query(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def current_user() -> AuthUser | None:
    identity = get_jwt_identity()
    if not identity:
        return None
    user, _record = find_auth_user(str(identity))
    if not user or not user.is_active:
        return None
    return user


def require_roles(*allowed_roles: str):
    normalized_allowed = {role.strip().lower() for role in allowed_roles if role.strip()}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return jsonify({"error": "User not found."}), 404
            if user.role not in normalized_allowed:
                return jsonify({"error": "Forbidden."}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def require_owner(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "User not found."}), 404
        if not user.is_owner:
            return jsonify({"error": "Only the owner account can manage LinkedIn manual scheduling."}), 403
        return fn(*args, **kwargs)

    return wrapper


def require_owner_account_control(target_username: str) -> tuple[AuthUser | None, Any | None]:
    actor = current_user()
    if is_primary_developer_username(target_username) and (not actor or not actor.is_owner):
        return actor, (jsonify({"error": "Only the owner account can modify the owner account."}), 403)
    return actor, None


def validate_platforms(platforms: list[str]) -> tuple[bool, str | None]:
    invalid = [p for p in platforms if p not in SUPPORTED_PLATFORMS]
    if invalid:
        return False, f"Unsupported platforms: {', '.join(invalid)}"
    return True, None


def get_global_settings() -> dict[str, str]:
    values = DEFAULT_SETTINGS.copy()
    values.update(AppSetting.get_many(GLOBAL_SETTING_KEYS))
    values["timezone"] = normalize_timezone_name(values.get("timezone")) or APP_TIMEZONE_NAME
    return values


def monthly_insights_spreadsheet_ref() -> str:
    stored = str(AppSetting.get_setting(MONTHLY_INSIGHTS_SPREADSHEET_KEY, "") or "").strip()
    env_value = os.environ.get("MONTHLY_INSIGHTS_SPREADSHEET", "").strip()
    return stored or env_value


def monthly_insights_google_service_account_json() -> str:
    stored = str(AppSetting.get_setting(MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY, "") or "").strip()
    if stored:
        return stored
    env_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if env_json:
        return env_json
    env_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip() or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not env_file:
        return ""
    try:
        return Path(env_file).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def monthly_insights_meta_api_version() -> str:
    stored = str(AppSetting.get_setting(MONTHLY_INSIGHTS_META_API_VERSION_KEY, "") or "").strip()
    candidate = stored or MONTHLY_INSIGHTS_META_API_VERSION
    if not candidate.startswith("v"):
        candidate = f"v{candidate}"
    return candidate


def global_meta_user_token() -> str | None:
    token = (
        AppSetting.get_setting(GLOBAL_META_USER_TOKEN_KEY, "")
        or AppSetting.get_setting(LEGACY_META_GLOBAL_USER_TOKEN_KEY, "")
        or ""
    ).strip()
    return token or None


def set_app_setting_value(key: str, value: str | None, commit: bool = False) -> None:
    AppSetting.set_setting(key, value or "", commit=commit)


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


def global_linkedin_access_token() -> str | None:
    token = (AppSetting.get_setting(GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY, "") or "").strip()
    return token or None


def global_linkedin_refresh_token() -> str | None:
    token = (AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY, "") or "").strip()
    return token or None


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


def get_page_override_settings(page_id: int) -> dict[str, str]:
    return PageSetting.get_many(page_id, PAGE_OVERRIDEABLE_SETTING_KEYS)


def normalize_page_reference_sheet_key(value: str | None) -> str | None:
    cleaned = str(value or "").strip().lower().replace("-", "_")
    return cleaned if cleaned in PAGE_REFERENCE_SHEET_DEFINITIONS else None


def normalize_global_reference_sheet_key(value: str | None) -> str | None:
    cleaned = str(value or "").strip().lower().replace("-", "_")
    return cleaned if cleaned in GLOBAL_REFERENCE_SHEET_DEFINITIONS else None


def excel_column_label(index: int) -> str:
    value = max(int(index), 0)
    label = ""
    while True:
        value, remainder = divmod(value, 26)
        label = chr(65 + remainder) + label
        if value == 0:
            return label
        value -= 1


def default_reference_sheet_payload(sheet_key: str, definitions: dict[str, dict[str, str]]) -> dict[str, Any]:
    normalized_key = str(sheet_key or "").strip().lower().replace("-", "_")
    if normalized_key not in definitions:
        normalized_key = next(iter(definitions.keys()))
    definition = definitions[normalized_key]
    columns = [excel_column_label(index) for index in range(PAGE_REFERENCE_SHEET_DEFAULT_COLUMN_COUNT)]
    rows = [
        ["" for _ in range(PAGE_REFERENCE_SHEET_DEFAULT_COLUMN_COUNT)]
        for _ in range(PAGE_REFERENCE_SHEET_DEFAULT_ROW_COUNT)
    ]
    return {
        "sheet_key": normalized_key,
        "title": definition["default_title"],
        "columns": columns,
        "rows": rows,
    }


def normalize_reference_sheet_payload(
    payload: dict[str, Any] | None,
    sheet_key: str,
    definitions: dict[str, dict[str, str]],
) -> dict[str, Any]:
    normalized_key = str(sheet_key or "").strip().lower().replace("-", "_")
    if normalized_key not in definitions:
        raise ValueError("Unknown page reference sheet.")

    default_payload = default_reference_sheet_payload(normalized_key, definitions)
    if not isinstance(payload, dict):
        return default_payload

    raw_title = str(payload.get("title") or "").strip()
    title = raw_title[:PAGE_REFERENCE_SHEET_MAX_TITLE_LENGTH] or str(default_payload["title"])

    raw_columns = payload.get("columns")
    if not isinstance(raw_columns, list) or not raw_columns:
        raw_columns = list(default_payload["columns"])
    if len(raw_columns) > PAGE_REFERENCE_SHEET_MAX_COLUMNS:
        raise ValueError(f"Page sheets support at most {PAGE_REFERENCE_SHEET_MAX_COLUMNS} columns.")

    columns: list[str] = []
    for index, raw_column in enumerate(raw_columns):
        label = str(raw_column or "").strip()[:PAGE_REFERENCE_SHEET_MAX_LABEL_LENGTH]
        columns.append(label or excel_column_label(index))

    raw_rows = payload.get("rows")
    if raw_rows is None:
        raw_rows = list(default_payload["rows"])
    if not isinstance(raw_rows, list):
        raise ValueError("Sheet rows must be a list.")
    if len(raw_rows) > PAGE_REFERENCE_SHEET_MAX_ROWS:
        raise ValueError(f"Page sheets support at most {PAGE_REFERENCE_SHEET_MAX_ROWS} rows.")

    rows: list[list[str]] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, list):
            raise ValueError("Each sheet row must be a list of cells.")
        normalized_row: list[str] = []
        for column_index in range(len(columns)):
            value = raw_row[column_index] if column_index < len(raw_row) else ""
            cell_html = str(value or "")
            normalized_row.append(cell_html[:PAGE_REFERENCE_SHEET_MAX_CELL_HTML_LENGTH])
        rows.append(normalized_row)

    if not rows:
        rows = [["" for _ in columns]]

    return {
        "sheet_key": normalized_key,
        "title": title,
        "columns": columns,
        "rows": rows,
    }


def default_page_reference_sheet_payload(sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_page_reference_sheet_key(sheet_key) or "sheet_one"
    return default_reference_sheet_payload(normalized_key, PAGE_REFERENCE_SHEET_DEFINITIONS)


def normalize_page_reference_sheet_payload(payload: dict[str, Any] | None, sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_page_reference_sheet_key(sheet_key)
    if not normalized_key:
        raise ValueError("Unknown page reference sheet.")
    return normalize_reference_sheet_payload(payload, normalized_key, PAGE_REFERENCE_SHEET_DEFINITIONS)


def get_page_reference_sheet_payload(page_id: int, sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_page_reference_sheet_key(sheet_key)
    if not normalized_key:
        raise ValueError("Unknown page reference sheet.")

    setting_key = PAGE_REFERENCE_SHEET_DEFINITIONS[normalized_key]["setting_key"]
    raw_value = PageSetting.get_setting(page_id, setting_key, "") or ""
    if not raw_value.strip():
        return default_page_reference_sheet_payload(normalized_key)

    parsed = json_loads_safe(raw_value, {})
    try:
        return normalize_page_reference_sheet_payload(parsed, normalized_key)
    except ValueError:
        return default_page_reference_sheet_payload(normalized_key)


def save_page_reference_sheet_payload(page_id: int, sheet_key: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalize_page_reference_sheet_payload(payload, sheet_key)
    setting_key = PAGE_REFERENCE_SHEET_DEFINITIONS[normalized["sheet_key"]]["setting_key"]
    PageSetting.set_setting(page_id, setting_key, json.dumps(normalized), commit=False)
    return normalized


def default_global_reference_sheet_payload(sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_global_reference_sheet_key(sheet_key) or "contact_info"
    return default_reference_sheet_payload(normalized_key, GLOBAL_REFERENCE_SHEET_DEFINITIONS)


def normalize_global_reference_sheet_payload(payload: dict[str, Any] | None, sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_global_reference_sheet_key(sheet_key)
    if not normalized_key:
        raise ValueError("Unknown global reference sheet.")
    return normalize_reference_sheet_payload(payload, normalized_key, GLOBAL_REFERENCE_SHEET_DEFINITIONS)


def get_global_reference_sheet_payload(sheet_key: str) -> dict[str, Any]:
    normalized_key = normalize_global_reference_sheet_key(sheet_key)
    if not normalized_key:
        raise ValueError("Unknown global reference sheet.")

    setting_key = GLOBAL_REFERENCE_SHEET_DEFINITIONS[normalized_key]["setting_key"]
    raw_value = AppSetting.get_setting(setting_key, "") or ""
    if not raw_value.strip():
        return default_global_reference_sheet_payload(normalized_key)

    parsed = json_loads_safe(raw_value, {})
    try:
        return normalize_global_reference_sheet_payload(parsed, normalized_key)
    except ValueError:
        return default_global_reference_sheet_payload(normalized_key)


def save_global_reference_sheet_payload(sheet_key: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalize_global_reference_sheet_payload(payload, sheet_key)
    setting_key = GLOBAL_REFERENCE_SHEET_DEFINITIONS[normalized["sheet_key"]]["setting_key"]
    AppSetting.set_setting(setting_key, json.dumps(normalized), commit=False)
    return normalized


def get_effective_settings(page_id: int | None = None) -> dict[str, str]:
    settings = get_global_settings()
    if page_id is not None:
        settings.update(get_page_override_settings(page_id))
    return settings


def designer_label_for_user(user: AuthUser) -> str:
    return (user.display_name or user.username).strip() or user.username


def active_designer_names() -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for user in list_auth_users():
        if user.role != "designer" or not user.is_active:
            continue
        label = designer_label_for_user(user)
        key = label.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(label)
    return sorted(names, key=str.casefold)


def default_designer_email_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for user in list_auth_users():
        if user.role != "designer" or not user.is_active or not user.email:
            continue
        mapping[designer_label_for_user(user)] = user.email
    return mapping


def parse_designer_email_map(raw: str | None) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for line in str(raw or "").splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        separator = "=" if "=" in cleaned else ":" if ":" in cleaned else None
        if separator is None:
            raise ValueError("Designer email mappings must use one entry per line in the form Name=email@example.com.")
        name, email = cleaned.split(separator, 1)
        name = name.strip()
        email = email.strip()
        if not name or not email:
            raise ValueError("Designer email mappings must include both a designer name and an email address.")
        mapping[name] = email
    return mapping


def serialize_designer_email_map(mapping: dict[str, str] | None = None) -> str:
    source = mapping or default_designer_email_map()
    return "\n".join(f"{name}={email}" for name, email in source.items() if str(name).strip() and str(email).strip())


def default_admin_warning_recipients() -> list[str]:
    recipients: list[str] = []
    seen: set[str] = set()

    def _add(email_value: str | None) -> None:
        email = str(email_value or "").strip().casefold()
        if not email or email in seen:
            return
        seen.add(email)
        recipients.append(str(email_value or "").strip())

    users = list_auth_users()
    for user in users:
        if not user.is_active or not user.email:
            continue
        if user.is_owner or user.role == "admin":
            _add(user.email)

    if recipients:
        return recipients

    for user in users:
        if not user.is_active or not user.email:
            continue
        if user.role == "developer":
            _add(user.email)
    return recipients


def get_designer_email_map() -> dict[str, str]:
    raw = AppSetting.get_setting(DESIGNER_EMAIL_MAP_KEY, "") or ""
    if not raw.strip():
        return default_designer_email_map()
    parsed = parse_designer_email_map(raw)
    fallback = default_designer_email_map()
    for name, email in fallback.items():
        parsed.setdefault(name, email)
    return parsed


def get_designer_email_map_setting_value() -> str:
    raw = AppSetting.get_setting(DESIGNER_EMAIL_MAP_KEY, "") or ""
    if raw.strip():
        return raw
    return serialize_designer_email_map()


def ensure_planning_sheet_for_page(page_id: int) -> PlanningSheet:
    sheet = PlanningSheet.query.filter_by(page_id=page_id).first()
    if sheet:
        return sheet
    sheet = PlanningSheet(page_id=page_id)
    db.session.add(sheet)
    db.session.commit()
    return sheet


def planning_designer_options() -> list[str]:
    options = set(active_designer_names())
    for (value,) in db.session.query(PlanningRow.designer).filter(PlanningRow.designer.isnot(None)).distinct().all():
        cleaned = str(value or "").strip()
        if cleaned:
            options.add(cleaned)
    return sorted(options, key=str.casefold)


def build_linked_accounts_text(page: Page) -> str:
    platforms = sorted({account.platform for account in page.social_accounts if account.is_active})
    return "\n".join(platform.capitalize() for platform in platforms)


def next_planning_row_order(sheet_id: int) -> int:
    max_value = db.session.query(func.max(PlanningRow.row_order)).filter(PlanningRow.sheet_id == sheet_id).scalar()
    return int(max_value or 0) + 1


def parse_planning_time_value(raw_time: str | None) -> datetime.time | None:
    cleaned = str(raw_time or "").strip()
    if not cleaned:
        return None
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(cleaned, fmt).time()
        except ValueError:
            continue
    return None


def planning_row_sort_key(row: "PlanningRow") -> tuple[int, int, int, int, int]:
    parsed_date = parse_planning_date_value(getattr(row, "date_value", None))
    parsed_time = parse_planning_time_value(getattr(row, "time_value", None))
    if parsed_date is None:
        return (1, 10**9, 10**9, int(getattr(row, "row_order", 0) or 0), int(getattr(row, "id", 0) or 0))

    time_minutes = parsed_time.hour * 60 + parsed_time.minute if parsed_time is not None else 24 * 60 + 1
    return (
        0,
        parsed_date.toordinal(),
        time_minutes,
        int(getattr(row, "row_order", 0) or 0),
        int(getattr(row, "id", 0) or 0),
    )


PLANNING_CSV_IMPORT_HEADER_MAP = {
    "jobnr": "job_nr",
    "date": "date_value",
    "time": "time_value",
    "theme": "theme",
    "postcopy": "post_copy",
    "link": "link",
    "format": "format",
    "finalcreative": "final_creative",
    "deadline": "deadline",
    "deadlines": "deadline",
    "mssnotes": "mss_notes",
}
PLANNING_CSV_IMPORT_FIELDS = [
    "job_nr",
    "date_value",
    "time_value",
    "theme",
    "post_copy",
    "link",
    "format",
    "final_creative",
    "deadline",
    "mss_notes",
]


def normalize_planning_import_match_key(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").casefold() if ch.isalnum())


def normalize_planning_csv_header(value: str | None) -> str:
    return normalize_planning_import_match_key(value)


def normalize_planning_import_time_value(raw_time: str | None) -> str | None:
    parsed = parse_planning_time_value(raw_time)
    return parsed.strftime("%H:%M") if parsed is not None else None


def planning_import_signature(values: dict[str, Any]) -> tuple[str, ...]:
    return tuple(str(values.get(field) or "").strip() for field in PLANNING_CSV_IMPORT_FIELDS)


def planning_import_signature_for_row(row: PlanningRow) -> tuple[str, ...]:
    return planning_import_signature(
        {
            "job_nr": row.job_nr,
            "date_value": row.date_value,
            "time_value": row.time_value,
            "theme": row.theme,
            "post_copy": row.post_copy,
            "link": row.link,
            "format": row.format,
            "final_creative": row.final_creative,
            "deadline": row.deadline,
            "mss_notes": row.mss_notes,
        }
    )


def extract_planning_import_row(raw_row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str], str | None]:
    values: dict[str, str] = {}
    for raw_key, raw_value in raw_row.items():
        if raw_key is None:
            continue
        mapped_key = PLANNING_CSV_IMPORT_HEADER_MAP.get(normalize_planning_csv_header(raw_key))
        if not mapped_key:
            continue
        cleaned = str(raw_value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        values[mapped_key] = cleaned

    if not any(values.values()):
        return None, [], None

    raw_date = values.get("date_value", "")
    has_non_date_values = any(values.get(field) for field in PLANNING_CSV_IMPORT_FIELDS if field != "date_value")
    if not raw_date:
        if has_non_date_values:
            return None, [], "Missing Date value."
        return None, [], None

    parsed_date = parse_planning_date_value(raw_date)
    if parsed_date is None:
        return None, [], f"Invalid Date value '{raw_date}'."

    issues: list[str] = []
    time_value = None
    raw_time = values.get("time_value", "")
    if raw_time:
        time_value = normalize_planning_import_time_value(raw_time)
        if not time_value:
            issues.append(f"Time '{raw_time}' could not be parsed and was left blank.")

    deadline_value = None
    raw_deadline = values.get("deadline", "")
    if raw_deadline:
        parsed_deadline = parse_planning_date_value(raw_deadline)
        if parsed_deadline is None:
            issues.append(f"Deadline '{raw_deadline}' could not be parsed and was left blank.")
        else:
            deadline_value = parsed_deadline.isoformat()

    payload = {
        "planning_month": parsed_date.strftime("%Y-%m"),
        "job_nr": values.get("job_nr") or None,
        "date_value": parsed_date.isoformat(),
        "time_value": time_value,
        "theme": values.get("theme") or None,
        "post_copy": values.get("post_copy") or None,
        "link": values.get("link") or None,
        "format": values.get("format") or None,
        "final_creative": values.get("final_creative") or None,
        "deadline": deadline_value,
        "mss_notes": values.get("mss_notes") or None,
    }
    return payload, issues, None


def move_processed_planning_import_file(source_path: Path) -> Path:
    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    candidate = PLANNING_IMPORT_PROCESSED_DIR / f"{timestamp}_{source_path.name}"
    counter = 1
    while candidate.exists():
        candidate = PLANNING_IMPORT_PROCESSED_DIR / f"{timestamp}_{counter}_{source_path.name}"
        counter += 1
    source_path.replace(candidate)
    return candidate


def resolve_planning_import_page_for_file(file_path: Path, pages: list[Page]) -> tuple[Page | None, str | None]:
    stem = file_path.stem.strip()
    if not stem:
        return None, "Filename is empty."

    id_match = re.search(r"(?:^|[^a-z0-9])page[-_ ]?(?P<id>\d+)(?:[^a-z0-9]|$)", stem, flags=re.IGNORECASE)
    if id_match:
        page_id = int(id_match.group("id"))
        for page in pages:
            if page.id == page_id:
                return page, None
        return None, f"Filename requested page-{page_id}, but no page with that ID exists."

    normalized_stem = normalize_planning_import_match_key(stem)
    exact_matches = [page for page in pages if normalize_planning_import_match_key(page.name) == normalized_stem]
    if len(exact_matches) == 1:
        return exact_matches[0], None
    if len(exact_matches) > 1:
        return None, f"Filename matches multiple pages exactly: {', '.join(page.name for page in exact_matches[:5])}."

    contains_matches = [
        page
        for page in pages
        if normalize_planning_import_match_key(page.name)
        and normalize_planning_import_match_key(page.name) in normalized_stem
    ]
    if len(contains_matches) == 1:
        return contains_matches[0], None
    if len(contains_matches) > 1:
        return None, f"Filename matches multiple pages: {', '.join(page.name for page in contains_matches[:5])}."

    return None, "Could not match this CSV filename to a page. Rename the file to the page name or use page-<id>.csv."


def import_planning_csvs_from_inbox() -> dict[str, Any]:
    files = sorted(PLANNING_IMPORT_INBOX_DIR.glob("*.csv"))
    report_items: list[dict[str, Any]] = []
    summary = {
        "inbox_path": str(PLANNING_IMPORT_INBOX_DIR),
        "processed_path": str(PLANNING_IMPORT_PROCESSED_DIR),
        "files_seen": len(files),
        "files_processed": 0,
        "files_failed": 0,
        "rows_imported": 0,
        "rows_skipped": 0,
        "report": report_items,
    }
    if not files:
        summary["message"] = "No planner CSV files were found in the import inbox."
        return summary

    pages = Page.query.options(joinedload(Page.social_accounts)).order_by(Page.name.asc()).all()
    for csv_path in files:
        item = {
            "file_name": csv_path.name,
            "status": "failed",
            "page_name": None,
            "page_id": None,
            "rows_imported": 0,
            "rows_skipped": 0,
            "imported_months": [],
            "issues": [],
            "processed_file": None,
        }
        report_items.append(item)

        page, page_error = resolve_planning_import_page_for_file(csv_path, pages)
        if not page:
            item["issues"].append(page_error or "Could not resolve target page.")
            summary["files_failed"] += 1
            continue

        sheet = ensure_planning_sheet_for_page(page.id)
        item["page_name"] = page.name
        item["page_id"] = page.id
        existing_signatures = {
            planning_import_signature_for_row(row)
            for row in PlanningRow.query.filter_by(sheet_id=sheet.id).all()
        }
        next_row_order = next_planning_row_order(sheet.id)
        imported_months: set[str] = set()

        try:
            imported_any = False
            with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    item["issues"].append("CSV file is missing a header row.")
                    summary["files_failed"] += 1
                    continue

                for line_number, raw_row in enumerate(reader, start=2):
                    payload, row_issues, skip_reason = extract_planning_import_row(raw_row)
                    if payload is None:
                        if skip_reason:
                            item["rows_skipped"] += 1
                            if len(item["issues"]) < 50:
                                item["issues"].append(f"Row {line_number}: {skip_reason}")
                        continue

                    signature = planning_import_signature(payload)
                    if signature in existing_signatures:
                        item["rows_skipped"] += 1
                        if len(item["issues"]) < 50:
                            item["issues"].append(f"Row {line_number}: skipped because the same planner row already exists.")
                        continue

                    row = PlanningRow(
                        sheet_id=sheet.id,
                        row_order=next_row_order,
                        planning_month=str(payload.get("planning_month") or current_planning_month_key()),
                        linked_accounts=build_linked_accounts_text(page),
                        job_color="#D9D9D9",
                    )
                    next_row_order += 1
                    apply_planning_row_updates(row, payload)
                    if not row.linked_accounts:
                        row.linked_accounts = build_linked_accounts_text(page)
                    db.session.add(row)
                    existing_signatures.add(signature)
                    imported_months.add(str(row.planning_month or ""))
                    item["rows_imported"] += 1
                    imported_any = True
                    for row_issue in row_issues:
                        if len(item["issues"]) < 50:
                            item["issues"].append(f"Row {line_number}: {row_issue}")

            db.session.commit()
            processed_path = move_processed_planning_import_file(csv_path)
            item["processed_file"] = str(processed_path)
            item["imported_months"] = sorted(month for month in imported_months if month)
            item["status"] = "processed"
            summary["files_processed"] += 1
            summary["rows_imported"] += item["rows_imported"]
            summary["rows_skipped"] += item["rows_skipped"]
            if not imported_any and not item["issues"]:
                item["issues"].append("No importable planning rows were found in this file.")
        except Exception as error:
            db.session.rollback()
            item["issues"].append(f"Unexpected import error: {error}")
            summary["files_failed"] += 1

    summary["message"] = (
        f"Planner CSV import finished. Files processed: {summary['files_processed']}, "
        f"files failed: {summary['files_failed']}, rows imported: {summary['rows_imported']}, "
        f"rows skipped: {summary['rows_skipped']}."
    )
    return summary


def parse_planning_schedule_datetime(date_value: str, time_value: str) -> datetime | None:
    raw_date = (date_value or "").strip()
    if not raw_date or not str(time_value or "").strip():
        return None

    parsed_time = parse_planning_time_value(time_value)
    if parsed_time is None:
        return None

    parsed_date = parse_planning_date_value(raw_date)
    if parsed_date is None:
        return None
    return datetime.combine(parsed_date, parsed_time)


def notifications_enabled_for_page(page_id: int | None) -> bool:
    return str(get_effective_settings(page_id).get("notification_enabled", "true")).lower() == "true"


def send_email_message(
    subject: str,
    body: str,
    recipients: list[str] | None = None,
    *,
    html_body: str | None = None,
) -> bool:
    recipient_list = [item.strip() for item in (recipients or EMAIL_TO) if str(item).strip()]
    if not SMTP_SERVER or not recipient_list or not EMAIL_FROM:
        logger.warning("Email skipped because SMTP_SERVER, EMAIL_FROM, or recipients are not configured.")
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = EMAIL_FROM
    message["To"] = ", ".join(recipient_list)
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    def _send(security_mode: str) -> None:
        if security_mode == "ssl":
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, context=context, timeout=30) as server:
                server.set_debuglevel(1 if SMTP_DEBUG else 0)
                if SMTP_USER:
                    server.login(SMTP_USER, SMTP_PASS)
                server.send_message(message)
            return

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.set_debuglevel(1 if SMTP_DEBUG else 0)
            if security_mode == "starttls":
                context = ssl.create_default_context()
                server.starttls(context=context)
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(message)

    attempted_modes: list[str] = []
    modes = [SMTP_SECURITY or "ssl"]
    if SMTP_TRY_FALLBACK:
        for fallback in ("ssl", "starttls", "none"):
            if fallback not in modes:
                modes.append(fallback)

    last_error: Exception | None = None
    for mode in modes:
        attempted_modes.append(mode)
        try:
            _send(mode)
            logger.info("Email sent via %s to %s with subject=%s", mode, recipient_list, subject)
            return True
        except Exception as error:  # pragma: no cover - network/runtime dependent
            last_error = error
            logger.warning("Email send attempt via %s failed: %s", mode, error)

    logger.error(
        "Failed to send email after modes=%s subject=%s error=%s",
        attempted_modes,
        subject,
        last_error,
    )
    return False


def render_planning_warning_email_html(
    *,
    page_name: str,
    job_ref: str,
    scheduled_dt: datetime,
    designer_name: str | None,
    problems: list[str],
    headline: str = "Warning-1 Day before scheduled post. Post incomplete.",
    intro_text: str = "This is an Automatic email from the MMS So-Me Auto webapp regarding an incomplete row due to be scheduled in exsactly one day.",
    problem_label: str = "Missing Fields-",
    severity: str = "warning",
) -> str:
    scheduled_label = scheduled_dt.strftime("%Y-%m-%d %H:%M")
    problem_items = "".join(f"<li>{escape(problem)}</li>" for problem in problems)
    designer_value = (designer_name or "-").strip() or "-"
    is_critical = severity == "critical"
    header_bg = "#7b1020" if is_critical else "#301117"
    header_border = "#a31d31" if is_critical else "#43161d"
    headline_fg = "#ffffff" if is_critical else "#ff5f56"
    intro_fg = "#ffe0db" if is_critical else "#c8d2e3"
    card_bg = "#151b25"
    detail_bg = "#1b2431"
    detail_border = "#324055"
    label_fg = "#8aa0bd"
    value_fg = "#eef3fb"
    problem_bg = "#2a1319" if is_critical else "#182130"
    problem_border = "#8a1d2d" if is_critical else "#2f3a4a"
    problem_heading_fg = "#ffffff" if is_critical else "#eef3fb"
    problem_label_fg = "#ffd2cc" if is_critical else "#ffb4b0"
    badge_text = "FINAL WARNING" if is_critical else "WARNING"
    return f"""
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#ffffff;font-family:Segoe UI,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" bgcolor="{card_bg}" style="width:720px;max-width:720px;background:{card_bg};border:1px solid {header_border};">
                <tr>
                  <td bgcolor="{header_bg}" style="padding:0;background:{header_bg};border-bottom:1px solid {header_border};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="{header_bg}" style="padding:14px 28px 8px;background:{header_bg};font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#ffe1db;">
                          {badge_text}
                        </td>
                      </tr>
                      <tr>
                        <td bgcolor="{header_bg}" style="padding:0 28px 10px;background:{header_bg};font-size:{'40px' if is_critical else '32px'};font-weight:900;line-height:1.02;color:{headline_fg};">
                          {escape(headline)}
                        </td>
                      </tr>
                      <tr>
                        <td bgcolor="{header_bg}" style="padding:0 28px 18px;background:{header_bg};font-size:14px;line-height:1.65;color:{intro_fg};">
                          {escape(intro_text)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{detail_bg}" style="background:{detail_bg};border:1px solid {detail_border};">
                      <tr>
                        <td style="padding:14px 16px 4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{label_fg};">Page</td>
                      </tr>
                      <tr>
                        <td style="padding:0 16px 14px;font-size:17px;font-weight:800;color:{value_fg};border-bottom:1px solid {detail_border};">{escape(page_name)}</td>
                      </tr>
                      <tr>
                        <td style="padding:14px 16px 4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{label_fg};">Job Nr</td>
                      </tr>
                      <tr>
                        <td style="padding:0 16px 14px;font-size:17px;font-weight:800;color:{value_fg};border-bottom:1px solid {detail_border};">{escape(job_ref)}</td>
                      </tr>
                      <tr>
                        <td style="padding:14px 16px 4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{label_fg};">Scheduled For</td>
                      </tr>
                      <tr>
                        <td style="padding:0 16px 14px;font-size:17px;font-weight:800;color:{value_fg};border-bottom:1px solid {detail_border};">{escape(scheduled_label)}</td>
                      </tr>
                      <tr>
                        <td style="padding:14px 16px 4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{label_fg};">Designer</td>
                      </tr>
                      <tr>
                        <td style="padding:0 16px 16px;font-size:17px;font-weight:800;color:{value_fg};">{escape(designer_value)}</td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{problem_bg}" style="margin-top:18px;background:{problem_bg};border:1px solid {problem_border};">
                      <tr>
                        <td style="padding:18px 18px 8px;font-size:24px;font-weight:900;color:{problem_heading_fg};">
                          Current problems:
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 18px 8px;font-size:13px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:{problem_label_fg};">
                          {escape(problem_label)}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 18px 18px;">
                          <ul style="margin:0 0 0 22px;padding:0;color:#eef3fb;line-height:1.95;font-size:17px;font-weight:700;">
                            {problem_items}
                          </ul>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """.strip()


def planning_warning_recipients_for_designer(designer_name: str | None) -> list[str]:
    target_name = str(designer_name or "").strip()
    if not target_name:
        return default_admin_warning_recipients() or EMAIL_TO
    mapping = get_designer_email_map()
    for name, email in mapping.items():
        if name.strip().lower() == target_name.lower():
            return [email]
    return default_admin_warning_recipients() or EMAIL_TO


def planning_warning_recipients_for_clarise() -> list[str]:
    # Temporary routing: Clarise/admin warnings go to configured EMAIL_TO, else active owner/admin emails.
    return EMAIL_TO or default_admin_warning_recipients()


def planning_row_missing_clarise_fields(row: PlanningRow) -> list[str]:
    missing: list[str] = []
    for field_name, label in PLANNING_CLARISE_REQUIRED_FIELDS.items():
        value = getattr(row, field_name, None)
        if not str(value or "").strip():
            missing.append(label)
    return missing


def clear_planning_warning_state(row: PlanningRow, warning_type: str) -> bool:
    changed = False
    if warning_type == "designer":
        if row.designer_warning_key or row.designer_warning_sent_at:
            row.designer_warning_key = None
            row.designer_warning_sent_at = None
            changed = True
    elif warning_type == "clarise":
        if row.clarise_warning_key or row.clarise_warning_sent_at:
            row.clarise_warning_key = None
            row.clarise_warning_sent_at = None
            changed = True
    elif warning_type == "ready":
        if row.ready_warning_key or row.ready_warning_sent_at:
            row.ready_warning_key = None
            row.ready_warning_sent_at = None
            changed = True
    return changed


def send_due_planning_warning_emails(now: datetime) -> None:
    ready_warning_window_end = now + timedelta(hours=PLANNING_READY_WARNING_LEAD_HOURS)
    warning_window_end_date = (now + timedelta(hours=PLANNING_WARNING_LEAD_HOURS)).date()
    rows = (
        PlanningRow.query.options(joinedload(PlanningRow.sheet).joinedload(PlanningSheet.page))
        .order_by(PlanningRow.id.asc())
        .all()
    )
    changed = False

    for row in rows:
        page = row.sheet.page if row.sheet else None
        if row.is_non_actionable:
            changed = clear_planning_warning_state(row, "designer") or changed
            changed = clear_planning_warning_state(row, "clarise") or changed
            changed = clear_planning_warning_state(row, "ready") or changed
            continue
        if page is None or not notifications_enabled_for_page(page.id):
            changed = clear_planning_warning_state(row, "designer") or changed
            changed = clear_planning_warning_state(row, "clarise") or changed
            changed = clear_planning_warning_state(row, "ready") or changed
            continue

        scheduled_dt = parse_planning_schedule_datetime(row.date_value or "", row.time_value or "")
        deadline_date = parse_planning_date_value(row.deadline or "")
        creative_items = row.creative_media_list()
        job_ref = (row.job_nr or f"Row {row.id}").strip()
        scheduled_text = scheduled_dt.strftime('%Y-%m-%d %H:%M') if scheduled_dt else "-"

        if (
            scheduled_dt
            and now < scheduled_dt <= ready_warning_window_end
            and not row.scheduled_post_id
            and (row.job_color or "").upper() != PLANNING_READY_COLOR
        ):
            ready_warning_key = scheduled_dt.isoformat()
            if row.ready_warning_key != ready_warning_key:
                subject = f"[MSS SoME-Auto] Critical warning | Job not green-ready | {page.name} | {job_ref}"
                problems = ["Job Nr is not marked green and ready to post."]
                body = (
                    "Critical warning-2 hours before scheduled post. Job not ready.\n\n"
                    "This is an Automatic email from the MMS So-Me Auto webapp regarding a row that is close to schedule time and is still not marked ready to post.\n\n"
                    f"Page: {page.name}\n"
                    f"Job Nr: {job_ref}\n"
                    f"Scheduled For: {scheduled_text}\n"
                    f"Deadline: {(row.deadline or '-').strip() or '-'}\n"
                    f"Designer: {(row.designer or '-').strip() or '-'}\n"
                    f"Job Nr Color: {(row.job_color or '').upper() or '-'}\n\n"
                    "Current problems:\n"
                    "Ready Status-\n"
                    "- Job Nr is not marked green and ready to post."
                )
                html_body = render_planning_warning_email_html(
                    page_name=page.name,
                    job_ref=job_ref,
                    scheduled_dt=scheduled_dt,
                    designer_name=(row.designer or "-").strip() or "-",
                    problems=problems,
                    headline="Critical warning-2 Hours before scheduled post. Job not ready.",
                    intro_text="This is an Automatic email from the MMS So-Me Auto webapp regarding a row that is now only two hours away from schedule time and is still not marked ready to post.",
                    problem_label="Ready Status-",
                    severity="critical",
                )
                if send_email_message(
                    subject,
                    body,
                    planning_warning_recipients_for_clarise(),
                    html_body=html_body,
                ):
                    row.ready_warning_key = ready_warning_key
                    row.ready_warning_sent_at = now
                    changed = True
        else:
            changed = clear_planning_warning_state(row, "ready") or changed

        deadline_warning_due = deadline_date is not None and deadline_date <= warning_window_end_date
        deadline_warning_key = deadline_date.isoformat() if deadline_date else None
        if not deadline_warning_due or not deadline_warning_key:
            changed = clear_planning_warning_state(row, "designer") or changed
            changed = clear_planning_warning_state(row, "clarise") or changed
            continue

        missing_fields = planning_row_missing_clarise_fields(row)
        if missing_fields:
            if row.clarise_warning_key != deadline_warning_key:
                subject = f"[MSS SoME-Auto] Planning row incomplete before deadline | {page.name} | {job_ref}"
                problems = [f"{field} has not been set." for field in missing_fields]
                body = (
                    "Warning-deadline approaching. Post incomplete.\n\n"
                    "This is an Automatic email from the MMS So-Me Auto webapp regarding an incomplete row whose deadline is due within one day or is already overdue.\n\n"
                    f"Page: {page.name}\n"
                    f"Job Nr: {job_ref}\n"
                    f"Deadline: {(row.deadline or '-').strip() or '-'}\n"
                    f"Scheduled For: {scheduled_text}\n"
                    f"Designer: {(row.designer or '-').strip() or '-'}\n"
                    f"Creative attached: {'yes' if creative_items else 'no'}\n\n"
                    "Current problems:\n"
                    "Missing Fields-\n"
                    + "\n".join(f"- {problem}" for problem in problems)
                )
                html_body = render_planning_warning_email_html(
                    page_name=page.name,
                    job_ref=job_ref,
                    scheduled_dt=scheduled_dt or now,
                    designer_name=(row.designer or "-").strip() or "-",
                    problems=problems,
                    headline="Warning-deadline approaching. Post incomplete.",
                    intro_text="This is an Automatic email from the MMS So-Me Auto webapp regarding an incomplete row whose internal deadline is due within one day or is already overdue.",
                    problem_label="Missing Fields-",
                    severity="warning",
                )
                if send_email_message(
                    subject,
                    body,
                    planning_warning_recipients_for_clarise(),
                    html_body=html_body,
                ):
                    row.clarise_warning_key = deadline_warning_key
                    row.clarise_warning_sent_at = now
                    changed = True
        else:
            changed = clear_planning_warning_state(row, "clarise") or changed

        if not creative_items:
            designer_name = (row.designer or "").strip()
            if not designer_name:
                changed = clear_planning_warning_state(row, "designer") or changed
                continue
            if row.designer_warning_key == deadline_warning_key:
                continue

            subject = f"[MSS SoME-Auto] Creative missing before deadline for {designer_name} | {page.name} | {job_ref}"
            problems = ["Design is missing."]
            body = (
                "Warning-deadline approaching. Design missing.\n\n"
                "This is an Automatic email from the MMS So-Me Auto webapp regarding a row whose deadline is due within one day or is already overdue, and the design is still missing.\n\n"
                f"Page: {page.name}\n"
                f"Job Nr: {job_ref}\n"
                f"Deadline: {(row.deadline or '-').strip() or '-'}\n"
                f"Scheduled For: {scheduled_text}\n"
                f"Designer: {designer_name}\n\n"
                "Current problems:\n"
                "Missing Fields-\n"
                "- Design is missing."
            )
            html_body = render_planning_warning_email_html(
                page_name=page.name,
                job_ref=job_ref,
                scheduled_dt=scheduled_dt or now,
                designer_name=designer_name,
                problems=problems,
                headline="Warning-deadline approaching. Design missing.",
                intro_text="This is an Automatic email from the MMS So-Me Auto webapp regarding a row whose internal deadline is due within one day or is already overdue, and the design is still missing.",
                problem_label="Missing Fields-",
                severity="warning",
            )
            if send_email_message(
                subject,
                body,
                planning_warning_recipients_for_designer(designer_name),
                html_body=html_body,
            ):
                row.designer_warning_key = deadline_warning_key
                row.designer_warning_sent_at = now
                changed = True
            continue

        changed = clear_planning_warning_state(row, "designer") or changed

    if changed:
        db.session.commit()


def build_planning_month_options(sheet_id: int) -> list[dict[str, Any]]:
    counts_query = (
        db.session.query(PlanningRow.planning_month, func.count(PlanningRow.id))
        .filter(PlanningRow.sheet_id == sheet_id)
        .filter(PlanningRow.planning_month.isnot(None))
        .group_by(PlanningRow.planning_month)
        .all()
    )
    counts: dict[str, int] = {}
    for raw_month, count in counts_query:
        normalized = normalize_planning_month(raw_month)
        if normalized:
            counts[normalized] = int(count)

    current_month = current_planning_month_key()
    current_year_start = f"{utcnow().year:04d}-01"
    earliest_month = min([current_year_start, *counts.keys()]) if counts else current_year_start
    latest_month = max([shift_planning_month(current_month, 24), *counts.keys()]) if counts else shift_planning_month(current_month, 24)

    return [
        {
            "value": month_key,
            "label": planning_month_label(month_key) or month_key,
            "row_count": counts.get(month_key, 0),
            "is_past": planning_month_is_past(month_key),
        }
        for month_key in iter_planning_month_keys(earliest_month, latest_month)
    ]


def apply_planning_row_updates(row: PlanningRow, data: dict[str, Any]) -> None:
    field_map = {
        "planning_month": "planning_month",
        "linked_accounts": "linked_accounts",
        "job_nr": "job_nr",
        "job_color": "job_color",
        "date_value": "date_value",
        "time_value": "time_value",
        "theme": "theme",
        "post_copy": "post_copy",
        "link": "link",
        "format": "format",
        "final_creative": "final_creative",
        "deadline": "deadline",
        "mss_notes": "mss_notes",
        "designer": "designer",
        "row_order": "row_order",
    }
    for payload_key, attr_name in field_map.items():
        if payload_key not in data:
            continue
        value = data.get(payload_key)
        if value is None:
            setattr(row, attr_name, None)
            continue
        if payload_key == "planning_month":
            normalized_month = normalize_planning_month(str(value))
            if not normalized_month:
                raise ValueError("Planning month must use YYYY-MM format.")
            setattr(row, attr_name, normalized_month)
            continue
        if payload_key == "designer":
            cleaned = str(value).strip()
            allowed_designers = set(planning_designer_options())
            if cleaned and cleaned not in allowed_designers:
                allowed_text = ", ".join(planning_designer_options()) or "no active designers"
                raise ValueError(f"Designer must be blank or one of: {allowed_text}.")
            setattr(row, attr_name, cleaned or None)
            continue
        if payload_key == "row_order":
            try:
                setattr(row, attr_name, int(value))
            except (TypeError, ValueError):
                pass
            continue
        cleaned = str(value).strip()
        if payload_key == "job_color" and cleaned:
            cleaned = cleaned.upper()
        setattr(row, attr_name, cleaned or None)

    if "is_non_actionable" in data:
        raw_non_actionable = data.get("is_non_actionable")
        next_is_non_actionable = (
            raw_non_actionable
            if isinstance(raw_non_actionable, bool)
            else str(raw_non_actionable).strip().lower() in {"1", "true", "yes", "on"}
        )
        apply_planning_row_non_actionable_state(row, next_is_non_actionable)

    if "date_value" in data:
        derived_month = planning_month_from_date(parse_planning_date_value(row.date_value))
        if derived_month:
            row.planning_month = derived_month
        elif not normalize_planning_month(row.planning_month):
            row.planning_month = current_planning_month_key()
    elif not normalize_planning_month(row.planning_month):
        row.planning_month = effective_planning_month_for_row(row)


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


def page_has_active_platform(page: Page, platform: str) -> bool:
    return platform in get_active_page_platforms(page)


def get_active_page_account(page: Page, platform: str) -> SocialAccount | None:
    for account in page.social_accounts:
        if account.is_active and account.platform == platform:
            return account
    return None


def normalize_monthly_sync_key(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def monthly_sync_month_window(now: datetime | None = None) -> dict[str, Any]:
    base = (now or utcnow()).date()
    current_month_start = base.replace(day=1)
    month_end = current_month_start - timedelta(days=1)
    month_start = month_end.replace(day=1)
    since_dt = datetime(month_start.year, month_start.month, month_start.day, 0, 0, 0)
    until_dt = datetime(month_end.year, month_end.month, month_end.day, 23, 59, 59)
    since_ts = int(since_dt.replace(tzinfo=APP_TIMEZONE).timestamp())
    until_ts = int(until_dt.replace(tzinfo=APP_TIMEZONE).timestamp())
    month_short = month_start.strftime("%b").upper()
    month_long = month_start.strftime("%B").upper()
    return {
        "year": month_start.year,
        "month": month_start.month,
        "month_key": month_start.strftime("%Y-%m"),
        "label": month_start.strftime("%B %Y"),
        "sheet_labels": {month_short, month_long},
        "since_ts": since_ts,
        "until_ts": until_ts,
    }


def parse_google_service_account_info(raw_json: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw_json)
    except ValueError as error:
        raise RuntimeError(f"Google service account JSON is invalid: {error}") from error

    if not isinstance(payload, dict):
        raise RuntimeError("Google service account JSON must be an object.")
    if str(payload.get("type") or "").strip() != "service_account":
        raise RuntimeError("Google credentials must be a service account JSON key.")
    if not str(payload.get("client_email") or "").strip():
        raise RuntimeError("Google service account JSON is missing client_email.")
    if not str(payload.get("private_key") or "").strip():
        raise RuntimeError("Google service account JSON is missing private_key.")
    return payload


def monthly_insights_google_service_account_email() -> str | None:
    raw_json = monthly_insights_google_service_account_json()
    if not raw_json:
        return None
    try:
        payload = parse_google_service_account_info(raw_json)
    except RuntimeError:
        return None
    email = str(payload.get("client_email") or "").strip()
    return email or None


def resolve_monthly_insights_spreadsheet_id(raw_value: str | None = None) -> str | None:
    cleaned = str(raw_value or monthly_insights_spreadsheet_ref() or "").strip()
    if not cleaned:
        return None
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", cleaned)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", cleaned):
        return cleaned
    return None


def build_google_sheets_service() -> Any:
    if build is None or service_account is None:
        raise RuntimeError("Google Sheets client libraries are not installed. Install backend requirements first.")

    raw_json = monthly_insights_google_service_account_json()
    if not raw_json:
        raise RuntimeError(
            "Google service account JSON is not configured. Add it in Settings or set GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS."
        )

    payload = parse_google_service_account_info(raw_json)
    credentials = service_account.Credentials.from_service_account_info(payload, scopes=GOOGLE_SHEETS_SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def explain_google_write_permission_error(spreadsheet_id: str) -> str:
    service_account_email = monthly_insights_google_service_account_email() or "the configured Google service account"
    return (
        "Google Sheets accepted the login but rejected the write request. "
        f"Give {service_account_email} Editor access to spreadsheet {spreadsheet_id}. "
        "If the target month cells, tab, or sheet ranges are protected, also allow that account to edit those protected ranges."
    )


def quote_google_sheet_title(title: str) -> str:
    escaped = title.replace("'", "''")
    return f"'{escaped}'"


def google_sheet_matrix(service: Any, spreadsheet_id: str, sheet_title: str, max_range: str = "A1:Y120") -> list[list[str]]:
    response = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{quote_google_sheet_title(sheet_title)}!{max_range}")
        .execute()
    )
    values = response.get("values") or []
    matrix: list[list[str]] = []
    for row in values:
        if isinstance(row, list):
            matrix.append([str(item) for item in row])
        else:
            matrix.append([str(row)])
    return matrix


def google_spreadsheet_sheet_titles(service: Any, spreadsheet_id: str) -> list[str]:
    response = (
        service.spreadsheets()
        .get(spreadsheetId=spreadsheet_id, fields="sheets(properties(title))")
        .execute()
    )
    titles: list[str] = []
    for item in response.get("sheets") or []:
        title = str(((item.get("properties") or {}).get("title")) or "").strip()
        if title:
            titles.append(title)
    return titles


def google_sheet_cell_value(matrix: list[list[str]], row_index: int, column_index: int) -> str:
    if row_index < 0 or column_index < 0:
        return ""
    if row_index >= len(matrix):
        return ""
    row = matrix[row_index]
    if column_index >= len(row):
        return ""
    return str(row[column_index] or "")


def monthly_sheet_month_value_column(matrix: list[list[str]], accepted_labels: set[str]) -> int | None:
    normalized_labels = {str(label).strip().upper() for label in accepted_labels if str(label).strip()}
    for row_index in range(min(len(matrix), 4)):
        row = matrix[row_index]
        for column_index, cell in enumerate(row):
            if str(cell or "").strip().upper() in normalized_labels:
                return column_index + 1
    return None


def monthly_sheet_section_bounds(matrix: list[list[str]], section_key: str) -> tuple[int | None, int | None]:
    normalized_section = normalize_monthly_sync_key(section_key)
    start_index: int | None = None
    for row_index, row in enumerate(matrix):
        first_cell = normalize_monthly_sync_key(row[0] if row else "")
        if first_cell == normalized_section:
            start_index = row_index
            break
    if start_index is None:
        return None, None

    end_index = len(matrix)
    for row_index in range(start_index + 1, len(matrix)):
        first_cell = normalize_monthly_sync_key(matrix[row_index][0] if matrix[row_index] else "")
        if first_cell in MONTHLY_SHEET_SECTION_HEADERS:
            end_index = row_index
            break
    return start_index, end_index


def monthly_sheet_metric_rows(
    matrix: list[list[str]],
    section_key: str,
    aliases_by_metric: dict[str, set[str]],
) -> dict[str, int]:
    start_index, end_index = monthly_sheet_section_bounds(matrix, section_key)
    if start_index is None or end_index is None:
        return {}

    rows_by_metric: dict[str, int] = {}
    normalized_aliases = {
        metric: {normalize_monthly_sync_key(alias) for alias in aliases}
        for metric, aliases in aliases_by_metric.items()
    }
    for row_index in range(start_index + 1, end_index):
        first_cell = normalize_monthly_sync_key(matrix[row_index][0] if matrix[row_index] else "")
        if not first_cell:
            continue
        for metric_key, aliases in normalized_aliases.items():
            if metric_key in rows_by_metric:
                continue
            if first_cell in aliases:
                rows_by_metric[metric_key] = row_index
    return rows_by_metric


def spreadsheet_column_letter(column_index: int) -> str:
    value = column_index + 1
    letters = ""
    while value > 0:
        value, remainder = divmod(value - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def build_single_cell_range(sheet_title: str, row_index: int, column_index: int) -> str:
    column_letter = spreadsheet_column_letter(column_index)
    return f"{quote_google_sheet_title(sheet_title)}!{column_letter}{row_index + 1}"


def coerce_numeric_metric_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def extract_meta_metric_total(payload: dict[str, Any], metric_name: str) -> int | None:
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return None

    totals: list[int] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        if str(item.get("name") or "").strip() != metric_name:
            continue
        values = item.get("values")
        if not isinstance(values, list):
            continue
        for entry in values:
            if not isinstance(entry, dict):
                continue
            numeric = coerce_numeric_metric_value(entry.get("value"))
            if numeric is not None:
                totals.append(numeric)
    if not totals:
        return None
    return int(sum(totals))


def fetch_meta_insights_metric_total(
    object_id: str,
    access_token: str,
    metric_candidates: list[str],
    *,
    platform_label: str,
    since_ts: int,
    until_ts: int,
    host: str = "graph.facebook.com",
) -> tuple[int | None, str | None]:
    if not object_id or not access_token:
        return None, f"{platform_label} object ID or access token is missing."

    version = monthly_insights_meta_api_version()
    warnings: list[str] = []
    for metric_name in metric_candidates:
        try:
            response = requests.get(
                f"https://{host}/{version}/{object_id}/insights",
                params={
                    "metric": metric_name,
                    "period": "day",
                    "since": since_ts,
                    "until": until_ts,
                    "access_token": access_token,
                },
                timeout=API_TIMEOUT_SECONDS,
            )
            payload = ensure_success(response, platform_label)
        except Exception as error:
            warnings.append(f"{metric_name}: {error}")
            continue

        total = extract_meta_metric_total(payload, metric_name)
        if total is not None:
            return total, None
        warnings.append(f"{metric_name}: no numeric data returned")

    return None, "; ".join(warnings) if warnings else f"No supported {platform_label} metrics returned data."


def fetch_graph_field_value(
    object_id: str,
    access_token: str,
    field_candidates: list[str],
    *,
    platform_label: str,
    host: str = "graph.facebook.com",
) -> tuple[int | None, str | None]:
    if not object_id or not access_token:
        return None, f"{platform_label} object ID or access token is missing."

    version = monthly_insights_meta_api_version()
    warnings: list[str] = []
    for field_name in field_candidates:
        try:
            response = requests.get(
                f"https://{host}/{version}/{object_id}",
                params={"fields": field_name, "access_token": access_token},
                timeout=API_TIMEOUT_SECONDS,
            )
            payload = ensure_success(response, platform_label)
        except Exception as error:
            warnings.append(f"{field_name}: {error}")
            continue

        numeric = coerce_numeric_metric_value(payload.get(field_name))
        if numeric is not None:
            return numeric, None
        warnings.append(f"{field_name}: field missing or non-numeric")

    return None, "; ".join(warnings) if warnings else f"No supported {platform_label} fields returned data."


def find_page_for_sheet_title(sheet_title: str, pages: list[Page]) -> Page | None:
    exact = next((page for page in pages if str(page.name or "").strip() == str(sheet_title or "").strip()), None)
    if exact:
        return exact

    normalized_title = normalize_monthly_sync_key(sheet_title)
    if not normalized_title:
        return None
    return next((page for page in pages if normalize_monthly_sync_key(page.name) == normalized_title), None)


def prepare_account_for_monthly_sync(page: Page, platform: str) -> SocialAccount | None:
    account = get_active_page_account(page, platform)
    if account is None:
        return None
    if account.platform in {"facebook", "instagram"} and global_meta_user_token():
        apply_global_meta_token_to_account(account)
        db.session.flush()
    return account


def build_monthly_sheet_updates_for_page(
    service: Any,
    spreadsheet_id: str,
    sheet_title: str,
    page: Page,
    month_window: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    matrix = google_sheet_matrix(service, spreadsheet_id, sheet_title)
    value_column = monthly_sheet_month_value_column(matrix, month_window["sheet_labels"])
    result: dict[str, Any] = {
        "sheet_title": sheet_title,
        "page_name": page.name,
        "status": "skipped",
        "cells_updated": 0,
        "warnings": [],
    }
    updates: list[dict[str, Any]] = []

    if value_column is None:
        result["warnings"].append(f"Could not find the {month_window['label']} month column in this sheet.")
        return updates, result

    facebook_rows = monthly_sheet_metric_rows(matrix, "facebook", FACEBOOK_SHEET_METRIC_ROW_ALIASES)
    instagram_rows = monthly_sheet_metric_rows(matrix, "instagram", INSTAGRAM_SHEET_METRIC_ROW_ALIASES)

    if not facebook_rows and not instagram_rows:
        result["warnings"].append("No Facebook or Instagram metric rows were found in this sheet.")
        return updates, result

    facebook_account = prepare_account_for_monthly_sync(page, "facebook")
    instagram_account = prepare_account_for_monthly_sync(page, "instagram")

    if facebook_rows and facebook_account is None:
        result["warnings"].append("No active Facebook account is connected for this page.")
    if instagram_rows and instagram_account is None:
        result["warnings"].append("No active Instagram account is connected for this page.")

    if facebook_account:
        for metric_key, row_index in facebook_rows.items():
            if metric_key == "followers":
                value, warning = fetch_graph_field_value(
                    str(facebook_account.page_id_external or ""),
                    str(facebook_account.access_token or ""),
                    FACEBOOK_FOLLOWER_FIELD_CANDIDATES,
                    platform_label="facebook",
                )
            else:
                value, warning = fetch_meta_insights_metric_total(
                    str(facebook_account.page_id_external or ""),
                    str(facebook_account.access_token or ""),
                    FACEBOOK_MONTHLY_METRIC_CANDIDATES.get(metric_key, []),
                    platform_label="facebook",
                    since_ts=month_window["since_ts"],
                    until_ts=month_window["until_ts"],
                )
            if value is None:
                if warning:
                    result["warnings"].append(f"Facebook {metric_key}: {warning}")
                continue
            updates.append(
                {
                    "range": build_single_cell_range(sheet_title, row_index, value_column),
                    "values": [[value]],
                }
            )

    if instagram_account:
        for metric_key, row_index in instagram_rows.items():
            if metric_key == "followers":
                value, warning = fetch_graph_field_value(
                    str(instagram_account.page_id_external or ""),
                    str(instagram_account.access_token or ""),
                    INSTAGRAM_FOLLOWER_FIELD_CANDIDATES,
                    platform_label="instagram",
                )
            else:
                value, warning = fetch_meta_insights_metric_total(
                    str(instagram_account.page_id_external or ""),
                    str(instagram_account.access_token or ""),
                    INSTAGRAM_MONTHLY_METRIC_CANDIDATES.get(metric_key, []),
                    platform_label="instagram",
                    since_ts=month_window["since_ts"],
                    until_ts=month_window["until_ts"],
                )
            if value is None:
                if warning:
                    result["warnings"].append(f"Instagram {metric_key}: {warning}")
                continue
            updates.append(
                {
                    "range": build_single_cell_range(sheet_title, row_index, value_column),
                    "values": [[value]],
                }
            )

    result["cells_updated"] = len(updates)
    result["status"] = "updated" if updates else "skipped"
    return updates, result


def sync_previous_month_insights_to_google_sheet() -> dict[str, Any]:
    spreadsheet_id = resolve_monthly_insights_spreadsheet_id()
    if not spreadsheet_id:
        raise RuntimeError("Monthly insights spreadsheet is not configured. Add a spreadsheet URL or ID in Settings.")

    service = build_google_sheets_service()
    month_window = monthly_sync_month_window()
    sheet_titles = google_spreadsheet_sheet_titles(service, spreadsheet_id)
    pages = Page.query.options(joinedload(Page.social_accounts)).order_by(Page.name.asc()).all()
    logger.info(
        "Monthly workbook sync started. Spreadsheet=%s, month=%s, sheets=%s.",
        spreadsheet_id,
        month_window["label"],
        len(sheet_titles),
    )

    value_ranges: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    matched_sheet_count = 0

    for sheet_title in sheet_titles:
        page = find_page_for_sheet_title(sheet_title, pages)
        if page is None:
            logger.info("Monthly workbook sync skipped sheet '%s': no matching page.", sheet_title)
            report.append(
                {
                    "sheet_title": sheet_title,
                    "page_name": None,
                    "status": "skipped",
                    "cells_updated": 0,
                    "warnings": ["No page matches this worksheet title."],
                }
            )
            continue

        matched_sheet_count += 1
        logger.info("Monthly workbook sync processing sheet '%s' for page '%s'.", sheet_title, page.name)
        try:
            sheet_updates, sheet_result = build_monthly_sheet_updates_for_page(
                service,
                spreadsheet_id,
                sheet_title,
                page,
                month_window,
            )
        except Exception as error:
            report.append(
                {
                    "sheet_title": sheet_title,
                    "page_name": page.name,
                    "status": "failed",
                    "cells_updated": 0,
                    "warnings": [str(error)],
                }
            )
            continue
        value_ranges.extend(sheet_updates)
        logger.info(
            "Monthly workbook sync completed sheet '%s' with status=%s and cells=%s.",
            sheet_title,
            sheet_result.get("status"),
            sheet_result.get("cells_updated"),
        )
        report.append(sheet_result)

    if value_ranges:
        try:
            (
                service.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={
                        "valueInputOption": "RAW",
                        "data": value_ranges,
                    },
                )
                .execute()
            )
        except Exception as error:
            if HttpError is not None and isinstance(error, HttpError):
                status_code = getattr(getattr(error, "resp", None), "status", None)
                if status_code == 403:
                    raise RuntimeError(explain_google_write_permission_error(spreadsheet_id)) from error
            raise RuntimeError(f"Google Sheets batch update failed: {error}") from error
    db.session.commit()

    updated_sheets = sum(1 for item in report if item.get("status") == "updated")
    skipped_sheets = sum(1 for item in report if item.get("status") == "skipped")
    failed_sheets = sum(1 for item in report if item.get("status") == "failed")
    logger.info(
        "Monthly workbook sync finished. Month=%s, matched=%s, updated=%s, skipped=%s, failed=%s, cells=%s.",
        month_window["label"],
        matched_sheet_count,
        updated_sheets,
        skipped_sheets,
        failed_sheets,
        len(value_ranges),
    )
    return {
        "message": (
            f"Previous-month sync finished for {month_window['label']}. "
            f"Matched sheets: {matched_sheet_count}, updated: {updated_sheets}, skipped: {skipped_sheets}, failed: {failed_sheets}, cells written: {len(value_ranges)}."
        ),
        "month_key": month_window["month_key"],
        "month_label": month_window["label"],
        "spreadsheet_id": spreadsheet_id,
        "sheet_count": len(sheet_titles),
        "matched_sheet_count": matched_sheet_count,
        "updated_sheet_count": updated_sheets,
        "skipped_sheet_count": skipped_sheets,
        "failed_sheet_count": failed_sheets,
        "cells_written": len(value_ranges),
        "report": report,
    }


def local_datetime_to_unix_timestamp(value: datetime) -> int:
    if value.tzinfo is None:
        return int(value.replace(tzinfo=APP_TIMEZONE).timestamp())
    return int(value.astimezone(APP_TIMEZONE).timestamp())


def facebook_native_schedule_deadline(now: datetime | None = None) -> datetime:
    base = now or utcnow()
    return base + timedelta(minutes=FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES)


def page_requires_facebook_native_scheduling(page: Page) -> bool:
    return bool(page and should_use_live_posting(page.id) and get_active_page_account(page, "facebook"))


def validate_facebook_native_schedule_time(page: Page, scheduled_dt: datetime) -> None:
    if not page_requires_facebook_native_scheduling(page):
        return

    earliest = facebook_native_schedule_deadline()
    if scheduled_dt < earliest:
        raise RuntimeError(
            "Facebook-native scheduling requires posts to be scheduled at least "
            f"{FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES} minutes in advance."
        )


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

    file_storage.save(target_dir / unique_name)
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
    explicit_secret = os.environ.get("MEDIA_URL_SIGNING_SECRET", "").strip()
    if explicit_secret:
        return explicit_secret

    global _local_media_signing_secret
    if _local_media_signing_secret:
        return _local_media_signing_secret

    try:
        MEDIA_URL_SIGNING_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        if MEDIA_URL_SIGNING_SECRET_FILE.exists():
            persisted_secret = MEDIA_URL_SIGNING_SECRET_FILE.read_text(encoding="utf-8").strip()
            if persisted_secret:
                _local_media_signing_secret = persisted_secret
                return persisted_secret

        persisted_secret = os.urandom(32).hex()
        MEDIA_URL_SIGNING_SECRET_FILE.write_text(persisted_secret, encoding="ascii")
        _local_media_signing_secret = persisted_secret
        logger.warning(
            "MEDIA_URL_SIGNING_SECRET not set; created a persistent local signing secret at %s.",
            MEDIA_URL_SIGNING_SECRET_FILE,
        )
        return persisted_secret
    except OSError:
        logger.warning(
            "MEDIA_URL_SIGNING_SECRET not set and local signing secret file is unavailable; "
            "falling back to JWT_SECRET_KEY for media signing."
        )
        return app.config["JWT_SECRET_KEY"]


def public_base_url_uses_trycloudflare(public_base_url: str | None = None) -> bool:
    candidate = (public_base_url or os.environ.get("PUBLIC_BASE_URL", "")).strip().lower()
    return "trycloudflare.com" in candidate


def latest_runtime_trycloudflare_url() -> str | None:
    if not CLOUDFLARED_AUTO_LOG_PATH.exists():
        return None

    try:
        contents = CLOUDFLARED_AUTO_LOG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    matches = TRYCLOUDFLARE_URL_REGEX.findall(contents)
    if not matches:
        return None
    return matches[-1].rstrip("/")


def public_base_url_hostname_resolves(public_base_url: str | None) -> bool:
    candidate = (public_base_url or "").strip()
    if not candidate:
        return False

    hostname = urlsplit(candidate).hostname
    if not hostname:
        return False

    try:
        socket.getaddrinfo(hostname, 443)
    except OSError:
        return False
    return True


def resolve_public_base_url() -> str | None:
    current = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    latest_runtime = latest_runtime_trycloudflare_url()

    if current and not public_base_url_uses_trycloudflare(current):
        return current

    if latest_runtime and latest_runtime != current and public_base_url_hostname_resolves(latest_runtime):
        previous = current or "<empty>"
        os.environ["PUBLIC_BASE_URL"] = latest_runtime
        logger.warning(
            "Updated PUBLIC_BASE_URL from %s to %s using the latest Cloudflare quick tunnel log.",
            previous,
            latest_runtime,
        )
        return latest_runtime

    if current and public_base_url_hostname_resolves(current):
        return current

    if not current and latest_runtime and public_base_url_hostname_resolves(latest_runtime):
        os.environ["PUBLIC_BASE_URL"] = latest_runtime
        logger.warning("Recovered PUBLIC_BASE_URL as %s from the Cloudflare quick tunnel log.", latest_runtime)
        return latest_runtime

    return current or latest_runtime or None


def resolve_public_media_ttl(ttl_seconds: int | None = None) -> int:
    if ttl_seconds is None:
        ttl_seconds = PUBLIC_MEDIA_URL_TTL_SECONDS
    return max(int(ttl_seconds), 300)


def resolve_upload_relative_path(media_path: str) -> str | None:
    media_candidate = Path(media_path)
    if media_candidate.is_absolute():
        try:
            rel = media_candidate.resolve().relative_to(UPLOAD_DIR.resolve())
            return str(rel).replace("\\", "/")
        except ValueError:
            return None

    return str(media_candidate).replace("\\", "/").lstrip("/")


def build_signed_media_url(relative_path: str, ttl_seconds: int | None = None) -> str | None:
    public_base = (resolve_public_base_url() or "").strip().rstrip("/")
    if not public_base:
        return None

    expires = int(time.time()) + resolve_public_media_ttl(ttl_seconds)
    payload = f"{relative_path}:{expires}"
    signature = hmac.new(get_media_signing_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    quoted_path = quote(relative_path, safe="/")
    return f"{public_base}/public/uploads/{expires}/{signature}/{quoted_path}"


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


def make_public_media_url(media_path: str, ttl_seconds: int | None = None) -> str | None:
    if media_path.startswith(("http://", "https://")):
        return media_path

    relative = resolve_upload_relative_path(media_path)
    if not relative:
        return None
    return build_signed_media_url(relative, ttl_seconds=ttl_seconds)


def remap_trycloudflare_media_url(media_url: str) -> str:
    parts = urlsplit(media_url)
    if "trycloudflare.com" not in (parts.netloc or "").lower():
        return media_url

    current_public_base = resolve_public_base_url()
    if not current_public_base:
        return media_url

    base_parts = urlsplit(current_public_base)
    if not base_parts.netloc or base_parts.netloc.lower() == (parts.netloc or "").lower():
        return media_url

    return urlunsplit((base_parts.scheme or parts.scheme, base_parts.netloc, parts.path, parts.query, parts.fragment))


def validate_remote_media_url(media_url: str, *, expect_video: bool) -> str:
    candidate_url = remap_trycloudflare_media_url(media_url)

    for attempt in range(2):
        response: requests.Response | None = None
        try:
            response = requests.get(candidate_url, stream=True, timeout=API_TIMEOUT_SECONDS)
        except Exception as error:
            if attempt == 0:
                refreshed_url = remap_trycloudflare_media_url(candidate_url)
                if refreshed_url != candidate_url:
                    logger.warning(
                        "Retrying media URL preflight with refreshed quick tunnel base: %s -> %s",
                        candidate_url,
                        refreshed_url,
                    )
                    candidate_url = refreshed_url
                    continue
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
            return candidate_url
        finally:
            response.close()

    raise RuntimeError("Public media URL validation failed unexpectedly.")


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
        "https://graph.facebook.com/v19.0/oauth/access_token",
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
        f"https://graph.facebook.com/v19.0/{page_id}",
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
        f"https://graph.facebook.com/v19.0/{media_id}",
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
        endpoint = f"https://graph.facebook.com/v19.0/{target_id}/videos"
        data = {"published": "false", "access_token": account.access_token}
    else:
        endpoint = f"https://graph.facebook.com/v19.0/{target_id}/photos"
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
        f"https://graph.facebook.com/v19.0/{target_id}/feed",
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
            f"https://graph.facebook.com/v19.0/{target_id}/videos",
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
    resolved_media = [str(Path(path)) for path in media_paths]
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
        f"https://graph.facebook.com/v19.0/{remote_post_id}",
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
        f"https://graph.facebook.com/v19.0/{remote_post_id}",
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
    content: str,
    attached_media_ids: list[str],
) -> dict[str, Any]:
    payload: dict[str, Any] = {"message": content, "access_token": account.access_token}
    if attached_media_ids:
        payload.update(facebook_attached_media_fields(attached_media_ids))

    response = requests.post(
        f"https://graph.facebook.com/v19.0/{target_id}/feed",
        data=payload,
        timeout=API_TIMEOUT_SECONDS,
    )
    response_payload = ensure_success(response, "Facebook")
    post_id = response_payload.get("id")
    return {"success": True, "platform": "facebook", "post_id": post_id, "post_url": build_platform_post_url(account, "facebook", post_id)}


def instagram_container_status(account: SocialAccount, container_id: str) -> str | None:
    def action() -> dict[str, Any]:
        response = requests.get(
            f"https://graph.facebook.com/v19.0/{container_id}",
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
            f"https://graph.facebook.com/v19.0/{ig_user_id}/media",
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
    base_url = "https://graph.facebook.com/v19.0"
    content = post.content or ""

    if not media_paths:
        return publish_facebook_feed_post(account, target_id, content, [])

    if len(media_paths) == 1 and is_video_path(media_paths[0]):
        media_path = Path(media_paths[0])
        if not media_path.exists():
            raise RuntimeError(f"Media file not found: {media_path}")

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

    if any(is_video_path(media) for media in media_paths):
        raise RuntimeError(
            "Facebook feed attachment publishing supports photo sets only. "
            "Use a single video post or remove videos from the multi-media Facebook post."
        )

    attached_media_ids = [upload_facebook_attached_media(account, target_id, media) for media in media_paths]
    return publish_facebook_feed_post(account, target_id, content, attached_media_ids)


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
        media_url = validate_remote_media_url(media_url, expect_video=is_video_path(media_path))
        logger.info(
            "Instagram media preflight for post %s asset=%s url=%s",
            post.id,
            media_path,
            media_url,
        )
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
            f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish",
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

    if account.platform == "facebook":
        if post.facebook_remote_post_id:
            return scheduled_facebook_remote_result(post)

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


def apply_platform_result(post: Post, platform: str, platform_post_id: str | None, platform_post_url: str | None = None) -> None:
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
                apply_platform_result(post, platform, result.get("post_id"), result.get("post_url"))
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
        f"https://graph.facebook.com/v19.0/{target_id}",
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
        f"https://graph.facebook.com/v19.0/{ig_user_id}",
        params={
            "fields": "id,username",
            "access_token": access_token,
        },
        timeout=API_TIMEOUT_SECONDS,
    )
    return ensure_success(response, "Instagram")


def discover_accessible_instagram_accounts(access_token: str, limit: int = 5) -> list[str]:
    response = requests.get(
        "https://graph.facebook.com/v19.0/me/accounts",
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


def env_present(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def account_publish_missing_fields(account: SocialAccount) -> list[str]:
    missing = missing_credential_fields(account)

    if account.platform == "instagram" and not account.page_id_external:
        if "page_id_external (Instagram business account ID)" not in missing:
            missing.append("page_id_external (Instagram business account ID)")

    return missing


def get_integration_check_payload(page_id: int | None = None) -> dict[str, Any]:
    public_base_url = (resolve_public_base_url() or "").strip()
    live_enabled = should_use_live_posting(page_id)
    effective_settings = get_effective_settings(page_id)
    page_overrides = get_page_override_settings(page_id) if page_id is not None else {}
    selected_page = Page.query.get(page_id) if page_id is not None else None
    meta_status = global_meta_status()
    stored_meta_app_id = str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "").strip()
    stored_meta_app_secret = str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "").strip()
    resolved_meta_app_id, resolved_meta_app_secret = meta_app_credentials()
    spreadsheet_ref = monthly_insights_spreadsheet_ref()
    spreadsheet_id = resolve_monthly_insights_spreadsheet_id(spreadsheet_ref)
    google_service_account_email = monthly_insights_google_service_account_email()

    platform_env = {
        "facebook": {
            "META_APP_ID (settings/env)": bool(resolved_meta_app_id),
            "META_APP_SECRET (settings/env)": bool(resolved_meta_app_secret),
            "Stored in Global Settings": bool(stored_meta_app_id and stored_meta_app_secret),
        },
        "google_sheets": {
            "google_client_installed": build is not None and service_account is not None,
            "spreadsheet_configured": bool(spreadsheet_id),
            "service_account_configured": bool(google_service_account_email),
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
    if live_enabled and public_base_url_uses_trycloudflare(public_base_url):
        warnings.append(
            "PUBLIC_BASE_URL is using a temporary trycloudflare.com quick tunnel. "
            "Instagram/Pinterest media fetches are more reliable with a named Cloudflare tunnel or custom domain."
        )
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
    if build is None or service_account is None:
        warnings.append("Google Sheets client libraries are not installed; monthly sheet sync is unavailable.")
    if page_id is None and not spreadsheet_id:
        warnings.append("Monthly insights spreadsheet URL/ID is not configured.")
    if page_id is None and not google_service_account_email:
        warnings.append("Google service account JSON is not configured for monthly sheet sync.")

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
        "monthly_insights": {
            "enabled": page_id is None,
            "spreadsheet_ref": spreadsheet_ref or "",
            "spreadsheet_id": spreadsheet_id,
            "google_service_account_email": google_service_account_email,
            "meta_api_version": monthly_insights_meta_api_version(),
            "target_month": monthly_sync_month_window()["label"] if page_id is None else None,
        },
        "warnings": warnings,
    }


@app.route("/api/health", methods=["GET"])
def health() -> Any:
    return jsonify(
        {
            "status": "healthy",
            "app": "MSS SoME-Auto",
            "timestamp": utcnow().isoformat(),
            "timezone": APP_TIMEZONE_NAME,
        }
    )


@app.route("/api/auth/login", methods=["POST"])
def login() -> Any:
    data = get_json_body()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user, record = find_auth_user(username)
    if not user or not record or not user.is_active:
        return jsonify({"error": "Invalid username or password."}), 401
    password_hash = str(record.get("password_hash") or "").strip()
    if not password_hash or not check_password_hash(password_hash, password):
        return jsonify({"error": "Invalid username or password."}), 401

    claims = {"role": user.role}
    access_token = create_access_token(identity=user.username, additional_claims=claims)
    refresh_token = create_refresh_token(identity=user.username, additional_claims=claims)

    return jsonify(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "Bearer",
            "expires_in": 1800,
            "user": user.to_dict(),
        }
    )


@app.route("/api/auth/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh() -> Any:
    identity = get_jwt_identity()
    user, _record = find_auth_user(str(identity))
    if not user:
        return jsonify({"error": "User not found."}), 404

    new_access = create_access_token(identity=user.username, additional_claims={"role": user.role})
    return jsonify({"access_token": new_access})


@app.route("/api/auth/verify", methods=["GET"])
@jwt_required()
def verify_token() -> Any:
    user = current_user()
    if not user:
        return jsonify({"valid": False, "error": "User not found."}), 404
    return jsonify({"valid": True, "user": user.to_dict()})


@app.route("/api/auth/logout", methods=["POST"])
@jwt_required()
def logout() -> Any:
    return jsonify({"message": "Logged out. Remove tokens client-side."})


@app.route("/api/users", methods=["GET"])
@jwt_required()
@require_roles("developer")
def get_users() -> Any:
    payload = load_user_store()
    records = [
        serialize_user_record(record)
        for record in sorted_user_records([item for item in payload.get("users", []) if isinstance(item, dict)])
    ]
    return jsonify(records)


@app.route("/api/users", methods=["POST"])
@jwt_required()
@require_roles("developer")
def create_user() -> Any:
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid user payload."}), 400

    username = normalize_username(data.get("username"))
    password = str(data.get("password") or "")
    role = str(data.get("role") or "").strip().lower()
    email = str(data.get("email") or "").strip() or None
    display_name = str(data.get("display_name") or "").strip() or None
    raw_is_active = data.get("is_active", True)
    is_active = raw_is_active if isinstance(raw_is_active, bool) else str(raw_is_active).strip().lower() in {"1", "true", "yes", "on"}

    try:
        validate_username(username)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if role not in USER_ROLES:
        return jsonify({"error": "Role must be developer, admin, or designer."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long."}), 400

    payload = load_user_store()
    records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    if any(normalize_username(item.get("username")) == username for item in records):
        return jsonify({"error": "A user with that username already exists."}), 409

    try:
        validate_designer_label_uniqueness(records, username=username, role=role, display_name=display_name)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    record = {
        "username": username,
        "display_name": normalize_display_name(display_name, username),
        "email": email,
        "role": role,
        "is_active": is_active,
        "password_hash": generate_password_hash(password),
    }
    records.append(record)
    payload["users"] = sorted_user_records(records)
    save_user_store(payload)
    return jsonify(serialize_user_record(record)), 201


@app.route("/api/users/<username>", methods=["PUT"])
@jwt_required()
@require_roles("developer")
def update_user(username: str) -> Any:
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid user payload."}), 400

    _actor, owner_control_error = require_owner_account_control(username)
    if owner_control_error:
        return owner_control_error

    payload = load_user_store()
    records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    target_username = normalize_username(username)
    target_record = next(
        (item for item in records if normalize_username(item.get("username")) == target_username),
        None,
    )
    if not target_record:
        return jsonify({"error": "User not found."}), 404

    next_role = str(data.get("role", target_record.get("role") or "")).strip().lower()
    if next_role not in USER_ROLES:
        return jsonify({"error": "Role must be developer, admin, or designer."}), 400

    next_display_name = str(data.get("display_name", target_record.get("display_name") or "")).strip() or None
    next_email = str(data.get("email", target_record.get("email") or "")).strip() or None
    next_is_active = (
        bool(data.get("is_active"))
        if isinstance(data.get("is_active"), bool)
        else str(data.get("is_active", target_record.get("is_active", True))).strip().lower() in {"1", "true", "yes", "on"}
    )

    if is_primary_developer_username(target_username):
        next_role = "developer"
        next_is_active = True

    try:
        validate_designer_label_uniqueness(
            records,
            username=target_username,
            role=next_role,
            display_name=next_display_name,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    target_record["display_name"] = normalize_display_name(next_display_name, target_username)
    target_record["email"] = next_email
    target_record["role"] = next_role
    target_record["is_active"] = next_is_active

    supplied_password = str(data.get("password") or "")
    if supplied_password:
        if len(supplied_password) < 8:
            return jsonify({"error": "Password must be at least 8 characters long."}), 400
        target_record["password_hash"] = generate_password_hash(supplied_password)

    payload["users"] = sorted_user_records(records)
    save_user_store(payload)
    return jsonify(serialize_user_record(target_record))


@app.route("/api/users/<username>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_user(username: str) -> Any:
    target_username = normalize_username(username)
    actor, owner_control_error = require_owner_account_control(target_username)
    if owner_control_error:
        return owner_control_error
    if is_primary_developer_username(target_username):
        return jsonify({"error": "The owner account cannot be deleted."}), 400

    if actor and normalize_username(actor.username) == target_username:
        return jsonify({"error": "You cannot delete the account you are currently using."}), 400

    payload = load_user_store()
    original_records = [item for item in payload.get("users", []) if isinstance(item, dict)]
    remaining_records = [
        item for item in original_records if normalize_username(item.get("username")) != target_username
    ]
    if len(remaining_records) == len(original_records):
        return jsonify({"error": "User not found."}), 404

    payload["users"] = sorted_user_records(remaining_records)
    save_user_store(payload)
    return jsonify({"message": "User deleted successfully."})


@app.route("/api/pages", methods=["GET"])
@jwt_required()
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


@app.route("/api/pages", methods=["POST"])
@jwt_required()
@require_roles("developer")
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


@app.route("/api/pages/<int:page_id>", methods=["GET"])
@jwt_required()
def get_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    return jsonify(page.to_dict())


@app.route("/api/pages/<int:page_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/pages/<int:page_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    page_refs = collect_page_upload_refs(page)
    db.session.delete(page)
    db.session.commit()
    cleanup_unreferenced_uploads(page_refs)
    return jsonify({"message": "Page deleted successfully."})


@app.route("/api/pages/<int:page_id>/accounts", methods=["POST"])
@jwt_required()
@require_roles("developer")
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


@app.route("/api/accounts/<int:account_id>/test", methods=["POST"])
@jwt_required()
@require_roles("developer")
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


@app.route("/api/accounts/<int:account_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_social_account(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    db.session.delete(account)
    db.session.commit()
    return jsonify({"message": "Account deleted successfully."})


@app.route("/api/accounts/<int:account_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer")
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

    platform_changed = previous_platform != account.platform
    token_changed = previous_access_token != account.access_token
    external_id_changed = previous_page_id_external != account.page_id_external
    meta_global_available = bool(global_meta_user_token())
    if account.platform in {"facebook", "instagram"} and meta_global_available:
        account.refresh_token = None
        account.token_expires_at = None
        if "access_token" in data:
            account.access_token = previous_access_token
    if account.platform == "linkedin":
        account.access_token = None
        account.refresh_token = None
        account.page_id_external = None
        account.token_expires_at = None
        account.test_status = "success"
        account.test_error = "LinkedIn is currently in manual assist mode. No API token or organization ID is required."
    if account.platform in {"facebook", "instagram"} and (platform_changed or token_changed):
        account.token_expires_at = None
    if platform_changed or token_changed or external_id_changed:
        try:
            if account.platform in {"facebook", "instagram"} and meta_global_available:
                apply_global_meta_token_to_account(account)
            elif account.platform == "linkedin":
                validate_linkedin_account_binding(account)
            else:
                require_meta_publish_token_normalization(account)
                validate_instagram_account_binding(account)
                validate_linkedin_account_binding(account)
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": str(error)}), 400

    db.session.commit()
    return jsonify(account.to_dict())


@app.route("/api/accounts/<int:account_id>/refresh", methods=["POST"])
@jwt_required()
@require_roles("developer")
def manual_refresh_token(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    if account.platform == "linkedin":
        return jsonify({"error": "LinkedIn manual assist mode does not use refresh tokens right now."}), 400
    try:
        refresh_platform_token(account)
        db.session.commit()
        expires_at = account.token_expires_at.isoformat() if account.token_expires_at else None
        if account.platform == "linkedin" and global_linkedin_access_token():
            expires_at = global_linkedin_status().get("expires_at")
        return jsonify(
            {
                "message": "Token refreshed successfully.",
                "expires_at": expires_at,
                "platform": account.platform,
            }
        )
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/pages/<int:page_id>/posts", methods=["GET"])
@jwt_required()
def get_page_posts(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    status = request.args.get("status")

    query = Post.query.filter_by(page_id=page_id)
    if status:
        query = query.filter_by(status=status)

    posts = query.order_by(Post.created_at.desc()).all()
    return jsonify([p.to_dict() for p in posts])


@app.route("/api/posts", methods=["GET"])
@jwt_required()
def get_all_posts() -> Any:
    status = request.args.get("status")
    page_id = request.args.get("page_id", type=int)

    query = Post.query
    if status:
        query = query.filter_by(status=status)
    if page_id:
        query = query.filter_by(page_id=page_id)

    posts = query.order_by(Post.created_at.desc()).all()
    return jsonify([p.to_dict() for p in posts])


@app.route("/api/posts/<int:post_id>/linkedin/manual", methods=["POST"])
@jwt_required()
@require_owner
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


@app.route("/api/pages/<int:page_id>/posts", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/posts/<int:post_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/posts/<int:post_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/posts/<int:post_id>/publish", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/planning/sheets", methods=["GET"])
@jwt_required()
def get_planning_sheets() -> Any:
    pages = Page.query.options(joinedload(Page.social_accounts)).order_by(Page.created_at.desc()).all()
    changed = False
    sheets_by_page: dict[int, PlanningSheet] = {}
    existing_sheets = PlanningSheet.query.filter(PlanningSheet.page_id.in_([page.id for page in pages])).all() if pages else []
    for sheet in existing_sheets:
        sheets_by_page[sheet.page_id] = sheet

    for page in pages:
        if page.id in sheets_by_page:
            continue
        sheet = PlanningSheet(page_id=page.id)
        db.session.add(sheet)
        sheets_by_page[page.id] = sheet
        changed = True
    if changed:
        db.session.commit()

    row_count_map: dict[int, int] = {}
    if sheets_by_page:
        rows = (
            db.session.query(PlanningRow.sheet_id, func.count(PlanningRow.id))
            .filter(PlanningRow.sheet_id.in_([sheet.id for sheet in sheets_by_page.values()]))
            .group_by(PlanningRow.sheet_id)
            .all()
        )
        row_count_map = {int(sheet_id): int(count) for sheet_id, count in rows}

    items = []
    for page in pages:
        sheet = sheets_by_page.get(page.id)
        row_count = row_count_map.get(sheet.id, 0) if sheet else 0
        items.append(
            {
                "page_id": page.id,
                "page_name": page.name,
                "sheet_id": sheet.id if sheet else None,
                "row_count": row_count,
                "linked_accounts": build_linked_accounts_text(page),
            }
        )
    return jsonify(items)


@app.route("/api/pages/<int:page_id>/planning", methods=["GET"])
@jwt_required()
def get_planning_for_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    sheet = ensure_planning_sheet_for_page(page.id)
    selected_month = normalize_planning_month(request.args.get("month")) or current_planning_month_key()
    rows = (
        PlanningRow.query.filter_by(sheet_id=sheet.id, planning_month=selected_month)
        .all()
    )
    rows = sorted(rows, key=planning_row_sort_key)
    return jsonify(
        {
            "sheet": sheet.to_dict(),
            "page": page.to_dict(include_accounts=True),
            "rows": [row.to_dict() for row in rows],
            "selected_month": selected_month,
            "selected_month_label": planning_month_label(selected_month),
            "current_month": current_planning_month_key(),
            "month_options": build_planning_month_options(sheet.id),
            "designer_options": planning_designer_options(),
            "job_color_rules": {
                "required_to_schedule": PLANNING_READY_COLOR,
                "scheduled_value": PLANNING_SCHEDULED_COLOR,
                "posted_value": PLANNING_POSTED_COLOR,
                "failed_value": PLANNING_FAILED_COLOR,
            },
        }
    )


@app.route("/api/pages/<int:page_id>/planning/rows", methods=["POST"])
@jwt_required()
def create_planning_row(page_id: int) -> Any:
    page = Page.query.options(joinedload(Page.social_accounts)).get_or_404(page_id)
    sheet = ensure_planning_sheet_for_page(page.id)
    data = get_json_body()
    if not isinstance(data, dict):
        data = {}
    selected_month = normalize_planning_month(data.get("planning_month")) or current_planning_month_key()
    raw_non_actionable = data.get("is_non_actionable", False)
    is_non_actionable = raw_non_actionable if isinstance(raw_non_actionable, bool) else str(raw_non_actionable).strip().lower() in {"1", "true", "yes", "on"}
    if planning_month_is_past(selected_month):
        return jsonify({"error": "Past months are view-only. Create new planning rows in the current month or a future month."}), 400

    row = PlanningRow(
        sheet_id=sheet.id,
        row_order=next_planning_row_order(sheet.id),
        planning_month=selected_month,
        is_non_actionable=is_non_actionable,
        linked_accounts=build_linked_accounts_text(page),
        job_color="#D9D9D9",
    )
    try:
        apply_planning_row_updates(row, data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if not row.linked_accounts:
        row.linked_accounts = build_linked_accounts_text(page)

    db.session.add(row)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@app.route("/api/planning/rows/<int:row_id>", methods=["PUT"])
@jwt_required()
def update_planning_row(row_id: int) -> Any:
    row = PlanningRow.query.get_or_404(row_id)
    data = get_json_body()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid planning row payload."}), 400

    try:
        apply_planning_row_updates(row, data)
    except (RuntimeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    db.session.commit()
    return jsonify(row.to_dict())


@app.route("/api/planning/rows/bulk-update", methods=["POST"])
@jwt_required()
def bulk_update_planning_rows() -> Any:
    data = get_json_body()
    updates = data.get("updates") if isinstance(data, dict) else None
    if not isinstance(updates, list) or not updates:
        return jsonify({"error": "updates list is required."}), 400

    row_ids: list[int] = []
    for item in updates:
        if not isinstance(item, dict):
            return jsonify({"error": "Each update item must be an object."}), 400
        row_id = item.get("id")
        if not isinstance(row_id, int):
            return jsonify({"error": "Each update item requires integer id."}), 400
        row_ids.append(row_id)

    rows = PlanningRow.query.filter(PlanningRow.id.in_(row_ids)).all()
    rows_by_id = {row.id: row for row in rows}
    missing = [row_id for row_id in row_ids if row_id not in rows_by_id]
    if missing:
        return jsonify({"error": f"Planning rows not found: {', '.join(str(x) for x in missing[:20])}"}), 404

    for item in updates:
        row = rows_by_id[item["id"]]
        fields = item.get("fields")
        if not isinstance(fields, dict):
            return jsonify({"error": f"fields must be an object for row id {row.id}."}), 400
        try:
            apply_planning_row_updates(row, fields)
        except (RuntimeError, ValueError) as error:
            return jsonify({"error": f"Row {row.id}: {error}"}), 400

    db.session.commit()
    return jsonify({"rows": [rows_by_id[row_id].to_dict() for row_id in row_ids]})


@app.route("/api/planning/rows/<int:row_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer", "admin")
def delete_planning_row(row_id: int) -> Any:
    row = PlanningRow.query.get_or_404(row_id)
    previous_media = set(row.creative_media_list())
    db.session.delete(row)
    db.session.commit()
    cleanup_unreferenced_uploads(previous_media)
    return jsonify({"message": "Planning row deleted."})


@app.route("/api/planning/rows/<int:row_id>/creative", methods=["POST"])
@jwt_required()
def upload_planning_creative(row_id: int) -> Any:
    row = PlanningRow.query.options(joinedload(PlanningRow.sheet).joinedload(PlanningSheet.page)).get_or_404(row_id)
    page = row.sheet.page if row.sheet else None
    if page is None:
        return jsonify({"error": "Planning row is not linked to a page."}), 400
    current_media = row.creative_media_list()
    previous_media = set(current_media)
    media_items = list(current_media)

    if "media_order" in request.form:
        media_order = json_loads_safe(request.form.get("media_order"), [])
        pending_order = json_loads_safe(request.form.get("pending_order"), [])
        if not isinstance(media_order, list) or not isinstance(pending_order, list):
            return jsonify({"error": "media_order and pending_order must be JSON arrays."}), 400

        existing_allowed = set(current_media)
        pending_tokens = [str(item).strip() for item in pending_order if str(item).strip()]
        if len(set(pending_tokens)) != len(pending_tokens):
            return jsonify({"error": "pending_order contains duplicate items."}), 400

        uploaded_files = [item for item in request.files.getlist("creative") if item and item.filename]
        if len(uploaded_files) != len(pending_tokens):
            return jsonify({"error": "Pending upload count does not match pending_order."}), 400

        pending_map: dict[str, str] = {}
        for token, media_file in zip(pending_tokens, uploaded_files):
            pending_map[token] = store_upload(media_file)

        resolved_media: list[str] = []
        for raw_token in media_order:
            token = str(raw_token).strip()
            if not token:
                continue
            if token.startswith("existing::"):
                path = token.removeprefix("existing::").strip()
                if path not in existing_allowed:
                    return jsonify({"error": "media_order contains invalid existing planner media."}), 400
                resolved_media.append(path)
                continue
            if token.startswith("pending::"):
                stored_path = pending_map.get(token)
                if not stored_path:
                    return jsonify({"error": "media_order references a pending upload that was not provided."}), 400
                resolved_media.append(stored_path)
                continue
            return jsonify({"error": "media_order contains unsupported token values."}), 400

        try:
            validate_page_creative_media(page, resolved_media)
        except RuntimeError as error:
            cleanup_unreferenced_uploads(set(pending_map.values()))
            return jsonify({"error": str(error)}), 400

        row.set_creative_media(resolved_media)
        db.session.commit()
        cleanup_unreferenced_uploads(previous_media)
        return jsonify(row.to_dict())

    if "existing_media" in request.form:
        existing_media = json_loads_safe(request.form.get("existing_media"), [])
        if not isinstance(existing_media, list):
            return jsonify({"error": "existing_media must be a JSON array."}), 400
        allowed = set(current_media)
        normalized_existing = [str(item).strip() for item in existing_media if str(item).strip()]
        invalid = [item for item in normalized_existing if item not in allowed]
        if invalid:
            return jsonify({"error": "existing_media contains invalid planner media references."}), 400
        media_items = normalized_existing

    uploaded_any = False
    for media_file in request.files.getlist("creative"):
        if media_file and media_file.filename:
            media_items.append(store_upload(media_file))
            uploaded_any = True

    if "existing_media" not in request.form and not uploaded_any:
        return jsonify({"error": "Creative file is required."}), 400

    try:
        validate_page_creative_media(page, media_items)
    except RuntimeError as error:
        cleanup_unreferenced_uploads(set(media_items) - set(previous_media))
        return jsonify({"error": str(error)}), 400

    row.set_creative_media(media_items)
    db.session.commit()
    cleanup_unreferenced_uploads(previous_media)
    return jsonify(row.to_dict())


@app.route("/api/planning/rows/<int:row_id>/schedule", methods=["POST"])
@jwt_required()
def schedule_from_planning_row(row_id: int) -> Any:
    row = PlanningRow.query.options(joinedload(PlanningRow.sheet).joinedload(PlanningSheet.page)).get_or_404(row_id)
    try:
        row, post = schedule_post_from_planning_row_record(row, require_ready_color=True, trigger="manual")
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 400

    return jsonify(
        {
            "message": "Post scheduled from planning row.",
            "row": row.to_dict(),
            "post": post.to_dict(),
        }
    )


@app.route("/api/planning/rows/<int:row_id>/publish", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def publish_from_planning_row(row_id: int) -> Any:
    row = PlanningRow.query.options(joinedload(PlanningRow.sheet).joinedload(PlanningSheet.page)).get_or_404(row_id)
    try:
        row, post, results = publish_post_from_planning_row_record(row, require_ready_color=True)
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 400

    success_count = len([result for result in results if result.get("success")])
    failure_count = len([result for result in results if not result.get("success")])
    return jsonify(
        {
            "message": (
                f"Publish now finished: {success_count} succeeded"
                f"{f', {failure_count} failed' if failure_count else ''}."
            ),
            "row": row.to_dict(),
            "post": post.to_dict(),
            "results": results,
        }
    )


@app.route("/api/planning/import-csvs", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def import_planning_csvs() -> Any:
    return jsonify(import_planning_csvs_from_inbox())


@app.route("/api/settings", methods=["GET"])
@jwt_required()
@require_roles("developer")
def get_settings() -> Any:
    payload = get_global_settings()
    payload["global_meta_user_token"] = global_meta_user_token() or ""
    payload[FACEBOOK_APP_ID_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or ""
    payload[FACEBOOK_APP_SECRET_SETTING_KEY] = AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or ""
    payload[MONTHLY_INSIGHTS_SPREADSHEET_KEY] = monthly_insights_spreadsheet_ref()
    payload[MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY] = monthly_insights_google_service_account_json()
    payload[MONTHLY_INSIGHTS_META_API_VERSION_KEY] = monthly_insights_meta_api_version()
    payload["global_linkedin_access_token"] = global_linkedin_access_token() or ""
    payload["global_linkedin_refresh_token"] = global_linkedin_refresh_token() or ""
    payload["global_linkedin_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or ""
    payload["global_linkedin_refresh_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or ""
    payload["designer_email_map"] = get_designer_email_map_setting_value()
    payload["meta_global"] = global_meta_status()
    payload["linkedin_global"] = global_linkedin_status()
    return jsonify(payload)


@app.route("/api/settings", methods=["PUT"])
@jwt_required()
@require_roles("developer")
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
        if key == MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY and str(value or "").strip():
            try:
                parse_google_service_account_info(str(value or "").strip())
            except RuntimeError as error:
                return jsonify({"error": str(error)}), 400
        if key == MONTHLY_INSIGHTS_META_API_VERSION_KEY and str(value or "").strip():
            cleaned_version = str(value or "").strip()
            if not re.fullmatch(r"v?\d+\.\d+", cleaned_version):
                return jsonify({"error": "Monthly insights Meta API version must look like v24.0."}), 400
        if key == "timezone":
            normalized = normalize_timezone_name(str(value))
            if not normalized:
                return jsonify({"error": "Invalid timezone. Use a valid IANA timezone, e.g. Africa/Johannesburg."}), 400
            value = normalized
        AppSetting.set_setting(key, str(value), commit=False)
    if meta_token_supplied and meta_token_changed:
        try:
            propagation_warnings = set_global_meta_user_token(
                data.get(GLOBAL_META_USER_TOKEN_KEY, data.get(LEGACY_META_GLOBAL_USER_TOKEN_KEY))
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
    if not ((meta_token_supplied and meta_token_changed) or (linkedin_token_supplied and linkedin_token_changed)):
        db.session.commit()

    payload = get_global_settings()
    payload["global_meta_user_token"] = global_meta_user_token() or ""
    payload[FACEBOOK_APP_ID_SETTING_KEY] = current_meta_app_id if FACEBOOK_APP_ID_SETTING_KEY not in data else str(AppSetting.get_setting(FACEBOOK_APP_ID_SETTING_KEY, "") or "")
    payload[FACEBOOK_APP_SECRET_SETTING_KEY] = current_meta_app_secret if FACEBOOK_APP_SECRET_SETTING_KEY not in data else str(AppSetting.get_setting(FACEBOOK_APP_SECRET_SETTING_KEY, "") or "")
    payload[MONTHLY_INSIGHTS_SPREADSHEET_KEY] = monthly_insights_spreadsheet_ref()
    payload[MONTHLY_INSIGHTS_GOOGLE_SERVICE_ACCOUNT_JSON_KEY] = monthly_insights_google_service_account_json()
    payload[MONTHLY_INSIGHTS_META_API_VERSION_KEY] = monthly_insights_meta_api_version()
    payload["global_linkedin_access_token"] = global_linkedin_access_token() or ""
    payload["global_linkedin_refresh_token"] = global_linkedin_refresh_token() or ""
    payload["global_linkedin_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_TOKEN_EXPIRES_AT_KEY, "") or ""
    payload["global_linkedin_refresh_token_expires_at"] = AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_EXPIRES_AT_KEY, "") or ""
    payload["designer_email_map"] = get_designer_email_map_setting_value()
    payload["meta_global"] = global_meta_status()
    payload["linkedin_global"] = global_linkedin_status()
    if meta_token_supplied and meta_token_changed:
        stored_meta_token = payload["global_meta_user_token"]
        meta_status = payload["meta_global"]
        if not supplied_meta_token:
            meta_token_result = {
                "message": "Global Meta token cleared.",
                "outcome": "cleared",
            }
        elif stored_meta_token and stored_meta_token != supplied_meta_token:
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


@app.route("/api/pages/<int:page_id>/settings", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/pages/<int:page_id>/settings", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/pages/<int:page_id>/reference-sheets/<sheet_key>", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/pages/<int:page_id>/reference-sheets/<sheet_key>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/reference-sheets/<sheet_key>", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
def get_global_reference_sheet(sheet_key: str) -> Any:
    normalized_key = normalize_global_reference_sheet_key(sheet_key)
    if not normalized_key:
        return jsonify({"error": "Unknown reference sheet."}), 404

    payload = get_global_reference_sheet_payload(normalized_key)
    payload["scope_label"] = "Pages"
    payload["message"] = "Reference sheet loaded successfully."
    return jsonify(payload)


@app.route("/api/reference-sheets/<sheet_key>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
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


@app.route("/api/scheduler/status", methods=["GET"])
@jwt_required()
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


@app.route("/api/tokens/status", methods=["GET"])
@jwt_required()
@require_roles("developer")
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


@app.route("/api/integrations/check", methods=["GET"])
@jwt_required()
@require_roles("developer")
def integration_check() -> Any:
    return jsonify(get_integration_check_payload())


@app.route("/api/pages/<int:page_id>/integrations/check", methods=["GET"])
@jwt_required()
@require_roles("developer")
def integration_check_for_page(page_id: int) -> Any:
    Page.query.get_or_404(page_id)
    return jsonify(get_integration_check_payload(page_id=page_id))


@app.route("/api/integrations/monthly-sheet-sync", methods=["POST"])
@jwt_required()
@require_roles("developer")
def monthly_sheet_sync() -> Any:
    try:
        return jsonify(sync_previous_month_insights_to_google_sheet())
    except RuntimeError as error:
        logger.warning("Monthly workbook sync failed: %s", error)
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        logger.exception("Monthly workbook sync failed unexpectedly.")
        return jsonify({"error": f"Monthly sync failed unexpectedly: {error}"}), 500


def normalize_public_upload_relative_path(filename: str) -> str | None:
    relative = str(Path(filename)).replace("\\", "/")
    if ".." in Path(relative).parts:
        return None
    return relative


def build_public_upload_response(relative: str, expires_at: int | None = None) -> Any:
    full_path = UPLOAD_DIR / relative
    if not full_path.exists():
        return jsonify({"error": "File not found."}), 404

    response = send_from_directory(str(UPLOAD_DIR), relative)
    cache_ttl = max((expires_at - int(time.time())) if expires_at is not None else resolve_public_media_ttl(), 0)
    response.headers["Cache-Control"] = f"public, max-age={cache_ttl}, no-transform"
    response.headers["Accept-Ranges"] = "bytes"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.route("/public/uploads/<int:expires_at>/<signature>/<path:filename>", methods=["GET", "HEAD"])
def serve_public_upload_path_signed(expires_at: int, signature: str, filename: str) -> Any:
    relative = normalize_public_upload_relative_path(filename)
    if not relative:
        return jsonify({"error": "Invalid file path."}), 400

    if not is_valid_signed_media_request(relative, str(expires_at), signature):
        return jsonify({"error": "Invalid or expired media link."}), 403

    return build_public_upload_response(relative, expires_at=expires_at)


@app.route("/public/uploads/<path:filename>", methods=["GET", "HEAD"])
def serve_public_upload(filename: str) -> Any:
    relative = normalize_public_upload_relative_path(filename)
    if not relative:
        return jsonify({"error": "Invalid file path."}), 400

    exp = request.args.get("exp")
    sig = request.args.get("sig")
    if not is_valid_signed_media_request(relative, exp, sig):
        return jsonify({"error": "Invalid or expired media link."}), 403

    expires_at: int | None = None
    try:
        expires_at = int(exp) if exp is not None else None
    except (TypeError, ValueError):
        expires_at = None
    return build_public_upload_response(relative, expires_at=expires_at)


@app.route("/uploads/<path:filename>")
def serve_upload(filename: str) -> Any:
    return send_from_directory(str(UPLOAD_DIR), filename)


@app.route("/")
def serve_frontend_index() -> Any:
    return send_from_directory(str(BASE_DIR / "frontend"), "index.html")


@app.route("/<path:path>")
def serve_frontend_assets(path: str) -> Any:
    frontend_path = BASE_DIR / "frontend" / path
    if frontend_path.is_file():
        return send_from_directory(str(BASE_DIR / "frontend"), path)
    return send_from_directory(str(BASE_DIR / "frontend"), "index.html")


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
    scheduler.start()
    logger.info("Scheduler started. Timezone=%s", APP_TIMEZONE_NAME)


if __name__ == "__main__":
    run_main = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if run_main or not app.debug:
        start_scheduler()
    app.run(host="0.0.0.0", port=5000, debug=True)
else:
    start_scheduler()
