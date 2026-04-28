from __future__ import annotations

from . import app as core
from .auth import AuthUser, list_auth_users
from .models import AppSetting, Page, PageSetting, PlanningRow, PlanningSheet, SocialAccount, db

Any = core.Any
APP_TIMEZONE_NAME = core.APP_TIMEZONE_NAME
DESIGNER_EMAIL_MAP_KEY = core.DESIGNER_EMAIL_MAP_KEY
DEFAULT_SETTINGS = core.DEFAULT_SETTINGS
EMAIL_FROM = core.EMAIL_FROM
EMAIL_TO = core.EMAIL_TO
FACEBOOK_APP_ID_SETTING_KEY = core.FACEBOOK_APP_ID_SETTING_KEY
FACEBOOK_APP_SECRET_SETTING_KEY = core.FACEBOOK_APP_SECRET_SETTING_KEY
GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY = core.GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY
GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY = core.GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY
GLOBAL_META_USER_TOKEN_KEY = core.GLOBAL_META_USER_TOKEN_KEY
GLOBAL_REFERENCE_SHEET_DEFINITIONS = core.GLOBAL_REFERENCE_SHEET_DEFINITIONS
GLOBAL_SETTING_KEYS = core.GLOBAL_SETTING_KEYS
GLOBAL_WRITABLE_SETTING_KEYS = core.GLOBAL_WRITABLE_SETTING_KEYS
LEGACY_META_GLOBAL_USER_TOKEN_KEY = core.LEGACY_META_GLOBAL_USER_TOKEN_KEY
PAGE_OVERRIDEABLE_SETTING_KEYS = core.PAGE_OVERRIDEABLE_SETTING_KEYS
PAGE_REFERENCE_SHEET_DEFAULT_COLUMN_COUNT = core.PAGE_REFERENCE_SHEET_DEFAULT_COLUMN_COUNT
PAGE_REFERENCE_SHEET_DEFAULT_ROW_COUNT = core.PAGE_REFERENCE_SHEET_DEFAULT_ROW_COUNT
PAGE_REFERENCE_SHEET_DEFINITIONS = core.PAGE_REFERENCE_SHEET_DEFINITIONS
PAGE_REFERENCE_SHEET_MAX_CELL_HTML_LENGTH = core.PAGE_REFERENCE_SHEET_MAX_CELL_HTML_LENGTH
PAGE_REFERENCE_SHEET_MAX_COLUMNS = core.PAGE_REFERENCE_SHEET_MAX_COLUMNS
PAGE_REFERENCE_SHEET_MAX_LABEL_LENGTH = core.PAGE_REFERENCE_SHEET_MAX_LABEL_LENGTH
PAGE_REFERENCE_SHEET_MAX_ROWS = core.PAGE_REFERENCE_SHEET_MAX_ROWS
PAGE_REFERENCE_SHEET_MAX_TITLE_LENGTH = core.PAGE_REFERENCE_SHEET_MAX_TITLE_LENGTH
USER_ROLES = core.USER_ROLES
current_planning_month_key = core.current_planning_month_key
datetime = core.datetime
escape = core.escape
func = core.func
json = core.json
json_loads_safe = core.json_loads_safe
normalize_planning_month = core.normalize_planning_month
normalize_timezone_name = core.normalize_timezone_name
parse_planning_date_value = core.parse_planning_date_value
SUPPORTED_PLATFORMS = core.SUPPORTED_PLATFORMS
utcnow = core.utcnow

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


def global_meta_user_token() -> str | None:
    token = (
        AppSetting.get_setting(GLOBAL_META_USER_TOKEN_KEY, "")
        or AppSetting.get_setting(LEGACY_META_GLOBAL_USER_TOKEN_KEY, "")
        or ""
    ).strip()
    return token or None


def set_app_setting_value(key: str, value: str | None, commit: bool = False) -> None:
    AppSetting.set_setting(key, value or "", commit=commit)

def global_linkedin_access_token() -> str | None:
    token = (AppSetting.get_setting(GLOBAL_LINKEDIN_ACCESS_TOKEN_KEY, "") or "").strip()
    return token or None


def global_linkedin_refresh_token() -> str | None:
    token = (AppSetting.get_setting(GLOBAL_LINKEDIN_REFRESH_TOKEN_KEY, "") or "").strip()
    return token or None

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
            raise ValueError("Designer email mappings must use one entry per line in the form Name=Example@sample.co.za.")
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


