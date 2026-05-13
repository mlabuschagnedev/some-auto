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
import smtplib
import ssl
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from PIL import Image
import requests
from flask import Blueprint, Flask, jsonify, has_app_context, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, func, inspect, or_, text
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
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(BASE_DIR / "uploads"))).resolve()
IMAGE_DIR = UPLOAD_DIR / "images"
VIDEO_DIR = UPLOAD_DIR / "videos"
PLANNING_IMPORT_DIR = Path(os.environ.get("PLANNING_IMPORT_DIR", str(BASE_DIR / "imports" / "planning"))).resolve()
PLANNING_IMPORT_INBOX_DIR = PLANNING_IMPORT_DIR / "inbox"
PLANNING_IMPORT_PROCESSED_DIR = PLANNING_IMPORT_DIR / "processed"

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
SUPPORTED_PLATFORMS = {"facebook", "instagram", "linkedin", "twitter", "pinterest"}
INSTAGRAM_IMAGE_RATIO_MIN = 4 / 5
INSTAGRAM_IMAGE_RATIO_MAX = 1.91
INSTAGRAM_RATIO_EPSILON = 0.01
API_TIMEOUT_SECONDS = int(os.environ.get("API_TIMEOUT_SECONDS", "30"))
APP_TIMEZONE_NAME = os.environ.get("APP_TIMEZONE", "Africa/Johannesburg")
APP_TIMEZONE = ZoneInfo(APP_TIMEZONE_NAME)
USERS_FILE = Path(os.environ.get("USERS_FILE", str(BASE_DIR / "instance" / "users.json"))).resolve()
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
LINKEDIN_ALLOWED_ORG_POST_ROLES = {
    "ADMINISTRATOR",
    "DIRECT_SPONSORED_CONTENT_POSTER",
    "CONTENT_ADMINISTRATOR",
    "CONTENT_ADMIN",
}
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
FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES = int(os.environ.get("FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES", "25"))
PLANNING_AUTO_SCHEDULE_LEAD_MINUTES = FACEBOOK_NATIVE_SCHEDULE_BUFFER_MINUTES + 1
PLANNING_WARNING_LEAD_HOURS = 24
PLANNING_READY_WARNING_LEAD_HOURS = 2
SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS = int(os.environ.get("SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS", "7200"))
SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS = int(os.environ.get("SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS", "6900"))
SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS = float(os.environ.get("SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS", "4"))
SOCIAL_INSIGHTS_META_API_VERSION = os.environ.get("SOCIAL_INSIGHTS_META_API_VERSION", "v25.0").strip() or "v25.0"
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


def local_datetime_to_unix_timestamp(value: datetime) -> int:
    if value.tzinfo is None:
        return int(value.replace(tzinfo=APP_TIMEZONE).timestamp())
    return int(value.astimezone(APP_TIMEZONE).timestamp())


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


def get_json_body() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


def parse_bool_query(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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


def env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def normalize_database_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if cleaned.startswith("postgres://"):
        cleaned = "postgresql+psycopg://" + cleaned.removeprefix("postgres://")
    elif cleaned.startswith("postgresql://") and "+psycopg" not in cleaned.split("://", 1)[0]:
        cleaned = "postgresql+psycopg://" + cleaned.removeprefix("postgresql://")
    return cleaned


def resolve_database_url() -> str:
    raw_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:EAVEplay!#%&2468@localhost:5432/some_auto",
    )
    database_url = normalize_database_url(raw_url)
    if database_url.startswith("sqlite") and not env_flag("ALLOW_SQLITE_FOR_TESTS"):
        raise RuntimeError(
            "SQLite is disabled for this app. Set DATABASE_URL to a PostgreSQL URL, "
            "or set ALLOW_SQLITE_FOR_TESTS=1 for isolated tests."
        )
    return database_url


def database_engine_options(database_url: str) -> dict[str, Any]:
    if database_url.startswith("postgresql"):
        return {
            "pool_pre_ping": True,
            "pool_recycle": int(os.environ.get("DATABASE_POOL_RECYCLE_SECONDS", "1800")),
            "pool_size": int(os.environ.get("DATABASE_POOL_SIZE", "5")),
            "max_overflow": int(os.environ.get("DATABASE_MAX_OVERFLOW", "10")),
        }
    return {"pool_pre_ping": True}


app = Flask(__name__)
DATABASE_URL = resolve_database_url()
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = database_engine_options(DATABASE_URL)
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
                "http://localhost:5555",
                "http://127.0.0.1:5555",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]
        }
    },
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mss-some-auto")
META_USER_TOKEN_CACHE: dict[str, dict[str, Any]] = {}

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
PLANNING_IMPORT_INBOX_DIR.mkdir(parents=True, exist_ok=True)
PLANNING_IMPORT_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "instance").mkdir(parents=True, exist_ok=True)

db = SQLAlchemy(app)
jwt = JWTManager(app)
scheduler = BackgroundScheduler(timezone=APP_TIMEZONE_NAME)

from .auth import ensure_user_store_file
from .models import ensure_runtime_schema, seed_defaults, seed_planning_sheets

ensure_user_store_file()

with app.app_context():
    db.create_all()
    ensure_runtime_schema()
    seed_defaults()
    seed_planning_sheets()

from .routes import register_blueprints
from .scheduler import start_scheduler

register_blueprints(app)


if __name__ == "__main__":
    run_main = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if run_main or not app.debug:
        start_scheduler()
    app.run(host="0.0.0.0", port=5000, debug=True)
else:
    if not env_flag("DISABLE_SCHEDULER"):
        start_scheduler()
