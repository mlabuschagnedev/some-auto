import os
import sys
import re
import uuid
import json
import hashlib
import base64
import datetime
import mimetypes
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Any, List, Dict, Optional, Tuple
from urllib import request as urllib_request
from urllib import error as urllib_error

from zoneinfo import ZoneInfo
from google.oauth2 import service_account
from googleapiclient.discovery import build
import win32com.client
import pywintypes

BASE_PATH = os.environ.get("AUTOPOST_BASE_PATH", r"C:\AutoPosts")
CLARISE_FOLDER_NAME = "Clarise"
CLARISE_SENDER_EMAIL = "clarise@marketingss.co.za"
BAIE_ACK_ALLOWED_WORDS = {"baie", "dankie"}
QUARANTINE_FOLDER_NAME = os.environ.get("AUTOPOST_QUARANTINE_FOLDER", "Needs Review")
ROUTING_AUDIT_ENABLED = os.environ.get("AUTOPOST_SAVE_ROUTING_AUDIT", "1").strip().lower() in {"1", "true", "yes", "on"}
AI_ROUTING_ENABLED = os.environ.get("AUTOPOST_AI_ROUTING_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
AI_CONFIDENCE_THRESHOLD = float(os.environ.get("AUTOPOST_AI_CONFIDENCE_THRESHOLD", "4.0"))
AI_MODEL = os.environ.get("AUTOPOST_AI_MODEL", "gpt-4.1-mini")
AI_TIMEOUT_SECONDS = int(os.environ.get("AUTOPOST_AI_TIMEOUT_SECONDS", "45"))
AI_MAX_IMAGE_BYTES = int(os.environ.get("AUTOPOST_AI_MAX_IMAGE_BYTES", str(4 * 1024 * 1024)))
SERVICE_ACCOUNT_FILE = os.environ.get(
    "AUTOPOST_GOOGLE_SERVICE_ACCOUNT", r"E:\Marcel\Documents\Coding-Projects\SoMe-Auto\some-auto-480808-200efd36e05c.json"
)
SHEET_ID = "1QQM1gBKBZxG3Y4A2A_EUlXRaExlfy_GQc24kxbAO_Js"
# The only active company for now; everything else is left wired but inactive.
ACTIVE_COMPANY_ONLY = os.environ.get("AUTOPOST_ACTIVE_COMPANY_ONLY", "UD Trucks East London")
TZ = ZoneInfo("Africa/Johannesburg")
TARGET_GREEN_RGB = (52, 168, 83)
INLINE_IMAGE_MAX_BYTES = int(os.environ.get("AUTOPOST_INLINE_IMAGE_MAX_BYTES", 5 * 1024))
ROUTABLE_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}
ROUTABLE_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
LAUBSTAR_SHARED_COMPANY_NAME = "UD Group"
LAUBSTAR_SHARED_MEMBERS = {
    "UD Trucks Lichtenburg",
    "UD Trucks Upington",
    "UD Trucks Klerksdorp",
    "UD Trucks Kathu",
}
LAUBSTAR_SHARED_TRIGGERS = {
    "laubstar group",
    "ud group",
    "ud trucks group",
    "ud trucks laubstar group",
    "schedule for laubstar",
}
WEAK_ALIASES = {
    "alrode",
    "boksburg",
    "east london",
    "kathu",
    "kld",
    "kt",
    "ltx",
    "mahindra",
    "powerstar",
    "upt",
    "laubstar",
    "laubstar group",
}
SUPPORTED_PLATFORMS = {
    p.strip().lower()
    for p in os.environ.get("AUTOPOST_SUPPORTED_PLATFORMS", "facebook,instagram").split(",")
    if p.strip()
}
if not SUPPORTED_PLATFORMS:
    SUPPORTED_PLATFORMS = {"facebook", "instagram"}
CHROME_USER_DATA_DIR = os.path.expandvars(
    os.environ.get(
        "AUTOPOST_CHROME_USER_DATA",
        os.path.join(r"%LOCALAPPDATA%\Google\Chrome\User Data", "AutoPostProfile"),
    )
)
CHROME_USER_DATA_DIR_LI = os.path.expandvars(
    os.environ.get(
        "AUTOPOST_LI_USER_DATA",
        os.path.join(r"%LOCALAPPDATA%\Google\Chrome\User Data", "AutoPostProfile_LI"),
    )
)
VIEWPORT_SIZE = {"width": 1920, "height": 1080}

# Sheet overrides when worksheet names differ.
SHEET_NAME_OVERRIDES = {
    "UD Trucks Lichtenburg": "UD Trucks LTX",
    "UD Trucks Klerksdorp": "UD Trucks KLD",
    "UD Trucks Upington": "UD Trucks UPT",
}
PLATFORM_URLS = {
    "facebook": "https://business.facebook.com/latest/home",
    "instagram": "https://business.facebook.com/latest/home",
    "linkedin": "https://www.linkedin.com/feed/",
}
SHEET_BASE_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
FACEBOOK_PAGE_ID = "122499280942211"
FACEBOOK_PAGE_URL = "https://business.facebook.com/latest/home?nav_ref=biz_unified_f3_login_page_to_mbs&asset_id=122499280942211"

# Known companies with aliases for robust matching

# Known companies with aliases for robust matching
COMPANIES: List[Dict[str, str | List[str]]] = [
    {"name": "FAW Trucks Germiston", "aliases": ["FAW Trucks Germiston", "FAW Germiston"]},
    {"name": "UD Trucks Alrode", "aliases": ["UD Trucks Alrode", "Alrode"]},
    {"name": "Priemier Workwear KZN", "aliases": ["Priemier Workwear KZN", "Premier Workwear KZN", "Workwear KZN"]},
    {"name": "Ctrack Botswana", "aliases": ["Ctrack Botswana"]},
    {"name": "UD Trucks Boksburg", "aliases": ["UD Trucks Boksburg", "Boksburg"]},
    {
        "name": "FAW Trucks LBS",
        "aliases": [
            "FAW Trucks LBS",
            "FAW Trucks Laubstar",
            "FAW Laubstar Group",
            "FAW Group",
        ],
    },
    {"name": "UD Group", "aliases": ["Laubstar Group","UD Trucks Laubstar Group", "UD Trucks Group"]},
    {"name": "Laubstar", "aliases": ["Laubstar Fleet services","Laubstar", "Laubstar Fleet"]},
    {"name": "UD Trucks Lichtenburg", "aliases": ["UD Trucks Lichtenburg", "LTX", "UD Trucks LTX"]},
    {"name": "UD Trucks Klerksdorp", "aliases": ["UD Trucks Klerksdorp", "KLD", "UD Trucks KLD"]},
    {"name": "UD Trucks Upington", "aliases": ["UD Trucks Upington", "UPT", "UD Trucks UPT"]},
    {"name": "UD Trucks Kathu", "aliases": ["UD Trucks Kathu", "Kathu"]},
    {"name": "Mahindra Centurion", "aliases": ["Mahindra Centurion", "Mahindra"]},
    {"name": "UD Trucks East London", "aliases": ["UD Trucks East London", "East London"]},
    {"name": "Powerstar Klerksdorp", "aliases": ["Powerstar Klerksdorp", "Powerstar"]},
    {"name": "MSS", "aliases": ["MSS", "Marketing Support Services"]},
    {"name": "BBP", "aliases": ["BBP", "Big Brand Productions", "Big Brand Productions."]},
]

_EXTRA_COMPANIES_CACHE: Optional[List[Dict[str, List[str]]]] = None


def _load_extra_companies() -> List[Dict[str, List[str]]]:
    global _EXTRA_COMPANIES_CACHE
    if _EXTRA_COMPANIES_CACHE is not None:
        return _EXTRA_COMPANIES_CACHE

    _EXTRA_COMPANIES_CACHE = []
    path = os.environ.get("AUTOPOST_COMPANY_ALIASES_FILE")
    if not path:
        return _EXTRA_COMPANIES_CACHE

    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, list):
                for entry in data:
                    if not isinstance(entry, dict):
                        continue
                    name = entry.get("name")
                    aliases = entry.get("aliases", [])
                    if name and isinstance(aliases, list):
                        _EXTRA_COMPANIES_CACHE.append({"name": name, "aliases": aliases})
    except Exception as exc:
        print(f"[COMPANIES] Could not load extra aliases from {path}: {exc}")

    return _EXTRA_COMPANIES_CACHE


def _company_catalog() -> List[Dict[str, str | List[str]]]:
    return COMPANIES + _load_extra_companies()


@dataclass
class PostingTask:
    company: str
    attachment_path: str
    platforms: List[str]
    caption: str
    scheduled_dt: datetime.datetime
    sheet_name: str
    sheet_gid: Optional[int]
    sheet_row_index: int  # 1-based for spreadsheet APIs
    matched_via: str


@dataclass
class RoutingDecision:
    target_company: Optional[str]
    confidence: float
    method: str
    reason: str
    candidates: List[str]
    alternatives: List[str]
    raw_ai: Optional[Dict[str, Any]] = None

    @property
    def should_quarantine(self) -> bool:
        return not self.target_company or self.confidence < AI_CONFIDENCE_THRESHOLD


def load_sheets_service():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"[SHEETS] Service account file not found: {SERVICE_ACCOUNT_FILE}")
        return None
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    try:
        creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
        return build("sheets", "v4", credentials=creds, cache_discovery=False)
    except Exception as exc:
        print(f"[SHEETS] Could not build Sheets client: {exc}")
        return None


def _normalize_filename(name: str) -> str:
    return (name or "").strip().lower()


def _cell_from_row(row: Dict, idx: int) -> Dict:
    values = row.get("values", [])
    if idx < len(values):
        return values[idx]
    return {}


def _cell_text(cell: Dict) -> str:
    if not cell:
        return ""
    if "formattedValue" in cell:
        return str(cell["formattedValue"])
    if "userEnteredValue" in cell:
        uev = cell["userEnteredValue"]
        for key in ("stringValue", "numberValue", "boolValue", "formulaValue"):
            if key in uev:
                return str(uev[key])
    return ""


def _cell_formula(cell: Dict) -> str:
    if not cell:
        return ""
    uev = cell.get("userEnteredValue", {})
    return str(uev.get("formulaValue", "") or "")


def _cell_hyperlink(cell: Dict) -> str:
    return str(cell.get("hyperlink", "") or "")


def _cell_background_rgb(cell: Dict) -> Tuple[int, int, int]:
    color = {}
    fmt = cell.get("effectiveFormat") or cell.get("userEnteredFormat") or {}
    color = fmt.get("backgroundColor", {}) or {}
    def conv(channel: str) -> int:
        return int(round((color.get(channel, 0) or 0) * 255))
    return (conv("red"), conv("green"), conv("blue"))


def _is_green(color: Tuple[int, int, int], target: Tuple[int, int, int] = TARGET_GREEN_RGB, tolerance: int = 40) -> bool:
    return sum(abs(a - b) for a, b in zip(color, target)) <= tolerance


def parse_platforms(raw: str) -> List[str]:
    cleaned = []
    for line in (raw or "").splitlines():
        val = line.strip()
        if not val:
            continue
        cleaned.append(val)
    return cleaned


def parse_sheet_datetime(date_str: str, time_str: str) -> Optional[datetime.datetime]:
    date_str = (date_str or "").strip()
    time_str = (time_str or "").strip()
    if not date_str or not time_str:
        return None

    patterns = ["%a, %d %B", "%d %B"]
    parsed_date = None
    for pat in patterns:
        try:
            parsed_date = datetime.datetime.strptime(date_str, pat)
            break
        except Exception:
            continue
    if parsed_date is None:
        return None

    try:
        parsed_time = datetime.datetime.strptime(time_str, "%H:%M")
    except Exception:
        return None

    now = datetime.datetime.now(TZ)
    combined = datetime.datetime(
        year=now.year,
        month=parsed_date.month,
        day=parsed_date.day,
        hour=parsed_time.hour,
        minute=parsed_time.minute,
        tzinfo=TZ,
    )
    return combined


def fetch_sheet_data(service, sheet_name: str):
    try:
        resp = (
            service.spreadsheets()
            .get(
                spreadsheetId=SHEET_ID,
                ranges=[f"'{sheet_name}'!A1:P"],
                includeGridData=True,
            )
            .execute()
        )
        sheet = resp["sheets"][0]
        gid = sheet.get("properties", {}).get("sheetId")
        row_data = sheet.get("data", [{}])[0].get("rowData", [])
        return gid, row_data
    except Exception as exc:
        print(f"[SHEETS] Could not fetch data for sheet '{sheet_name}': {exc}")
        return None, []


def write_sheet_value(service, sheet_name: str, cell_ref: str, value: str):
    try:
        service.spreadsheets().values().update(
            spreadsheetId=SHEET_ID,
            range=f"'{sheet_name}'!{cell_ref}",
            valueInputOption="RAW",
            body={"values": [[value]]},
        ).execute()
    except Exception as exc:
        print(f"[SHEETS] Failed to write {cell_ref} in '{sheet_name}': {exc}")


def find_matching_row(row_data: List[Dict], filename: str) -> Optional[Tuple[int, str]]:
    """
    Legacy matcher removed; we now pick the first green row instead.
    """
    return None


def pick_first_green_row(row_data: List[Dict]) -> Optional[int]:
    greens = []
    for idx, row in enumerate(row_data, start=1):
        col_b = _cell_from_row(row, 1)
        color_b = _cell_background_rgb(col_b)
        if _is_green(color_b):
            greens.append(idx)
    if not greens:
        return None
    return greens[0]


def build_tasks_from_sheet(company_name: str, attachment_paths: List[str]) -> List[PostingTask]:
    tasks: List[PostingTask] = []

    if company_name != ACTIVE_COMPANY_ONLY:
        print(f"[SHEETS] Skipping sheet lookup for '{company_name}' (inactive for now).")
        return tasks

    service = load_sheets_service()
    if service is None:
        print(f"[SHEETS] Skipping sheet lookup for '{company_name}' (Sheets client unavailable).")
        return tasks

    sheet_name = SHEET_NAME_OVERRIDES.get(company_name, company_name)
    gid, rows = fetch_sheet_data(service, sheet_name)
    if not rows:
        print(f"[SHEETS] No row data returned for sheet '{sheet_name}'.")
        return tasks

    green_row_idx = pick_first_green_row(rows)
    if green_row_idx is None:
        print(f"[SHEETS] No green rows in sheet '{sheet_name}'. Cannot build tasks.")
        return tasks

    row = rows[green_row_idx - 1]
    platforms = parse_platforms(_cell_text(_cell_from_row(row, 0)))
    if not platforms:
        print(f"[SHEETS] First green row {green_row_idx} has no platforms in column A. Skipping.")
        return tasks

    date_text = _cell_text(_cell_from_row(row, 2))
    time_text = _cell_text(_cell_from_row(row, 3))
    scheduled_dt = parse_sheet_datetime(date_text, time_text)
    if scheduled_dt is None:
        print(f"[SHEETS] Row {green_row_idx} has unparseable date/time: '{date_text}' '{time_text}'. Skipping.")
        return tasks

    caption = _cell_text(_cell_from_row(row, 5))

    for attachment_path in attachment_paths:
        filename = os.path.basename(attachment_path)
        task = PostingTask(
            company=company_name,
            attachment_path=attachment_path,
            platforms=platforms,
            caption=caption,
            scheduled_dt=scheduled_dt,
            sheet_name=sheet_name,
            sheet_gid=gid,
            sheet_row_index=green_row_idx,
            matched_via="first green row",
        )
        tasks.append(task)

    return tasks


def _open_sheet_views(tasks: List[PostingTask]):
    opened = set()
    for task in tasks:
        gid = task.sheet_gid if task.sheet_gid is not None else 0
        key = (task.sheet_name, gid)
        if key in opened:
            continue
        url = f"{SHEET_BASE_URL}#gid={gid}"
        try:
            os.startfile(url)
            opened.add(key)
            print(f"[SHEETS] Opened sheet view for '{task.sheet_name}' ({url}).")
        except Exception as exc:
            print(f"[SHEETS] Could not open sheet in browser: {exc}")


def _open_platform_entrypoints(tasks: List[PostingTask]):
    seen = set()
    for task in tasks:
        for platform in task.platforms:
            platform_key = platform.strip().lower()
            if platform_key in seen:
                continue
            seen.add(platform_key)
            yield platform_key


def launch_chrome_profile(pw, user_data_dir: Optional[str] = None, channel: str = "chrome"):
    """
    Try to launch a persistent Chrome context with the configured profile.
    If it fails (often due to the profile being locked by a running Chrome),
    fall back to a fresh AutoPostProfile under the same root.
    """
    attempted_paths = []
    first_path = os.path.expandvars(user_data_dir or CHROME_USER_DATA_DIR)
    fallback_path = first_path
    # If the user provided a root path (User Data), create a sub-profile to avoid lock
    if os.path.normcase(os.path.basename(first_path)) in ("user data", "user data\\"):
        fallback_path = os.path.join(first_path, "AutoPostProfile")

    for path in [first_path, fallback_path]:
        attempted_paths.append(path)
        try:
            os.makedirs(path, exist_ok=True)
            ctx = pw.chromium.launch_persistent_context(
                path,
                headless=False,
                channel=channel,
                viewport=VIEWPORT_SIZE,
                args=["--disable-notifications", "--start-maximized"],
            )
            print(f"[SOCIAL] Launched Chrome profile at {path}")
            return ctx
        except Exception as exc:
            print(f"[SOCIAL] Failed to launch Chrome with profile {path}: {exc}")

    raise RuntimeError(f"Could not launch Chrome with any profile. Tried: {attempted_paths}")


def record_status(service, task: PostingTask, success: bool, message: str):
    if service is None:
        return
    status_text = "Draft successful" if success else message
    try:
        write_sheet_value(service, task.sheet_name, f"O{task.sheet_row_index}", status_text)
        if success:
            write_sheet_value(service, task.sheet_name, f"P{task.sheet_row_index}", os.path.basename(task.attachment_path))
    except Exception as exc:
        print(f"[SHEETS] Could not record status for row {task.sheet_row_index}: {exc}")


def create_meta_draft(context, task: PostingTask, page=None) -> bool:
    """
    Meta composer fill for FB/IG. Works against the provided Business Suite URL.
    """
    composer_url = FACEBOOK_PAGE_URL
    if page is None:
        page = context.new_page()
    try:
        page.goto(composer_url, wait_until="domcontentloaded", timeout=90000)
    except Exception as exc:
        print(f"[SOCIAL][META] Could not open composer: {exc}")
        return False
    page.bring_to_front()
    page.wait_for_timeout(3000)
    try:
        page.evaluate("window.scrollTo(0,0)")
    except Exception:
        pass

    def composer_ready(pg):
        # Try to detect a caption box and add photo/video button
        caption_candidates = [
            pg.locator("div[role='textbox'][contenteditable='true']").first,
            pg.locator("div[role='textbox']").first,
            pg.locator("div[role='textbox']").nth(1),
            pg.locator("textarea").first,
            pg.get_by_label("Text").locator("div[role='textbox']").first,
            pg.locator("div[aria-label='Text']").first,
            pg.locator("div[aria-multiline='true']").first,
        ]
        caption_visible = False
        for cap in caption_candidates:
            try:
                if cap.is_visible(timeout=2000):
                    caption_visible = True
                    break
            except Exception:
                continue
        media_btn = pg.locator("button:has-text('Add photo/video'), [aria-label='Add photo/video']").first
        media_visible = False
        try:
            media_visible = media_btn.is_visible(timeout=2000)
        except Exception:
            pass
        return caption_visible and media_visible

    # If already on composer, skip the Create button
    if not composer_ready(page):
        create_clicked = False
        new_page = None
        create_selectors = [
            "button:has-text('Create post')",
            "div[role='button']:has-text('Create post')",
            "div[role='button']:has-text('Create Post')",
            "button[aria-label='Create post']",
        ]
        for sel in create_selectors:
            try:
                btn = page.locator(sel).first
                btn.wait_for(state="visible", timeout=5000)
                with context.expect_page(timeout=5000) as new_page_info:
                    btn.click(timeout=5000)
                page.wait_for_timeout(2000)
                try:
                    new_page = new_page_info.value
                    new_page.wait_for_load_state("domcontentloaded", timeout=15000)
                    page = new_page
                    print(f"[SOCIAL][META] Composer opened in new tab via {sel}")
                except Exception:
                    print(f"[SOCIAL][META] No new tab; staying on same page via {sel}")
                create_clicked = True
                break
            except Exception:
                continue
        if not create_clicked:
            try:
                page.evaluate("window.scrollBy(0, window.innerHeight)")
                page.wait_for_timeout(1000)
            except Exception:
                pass
            for sel in create_selectors:
                try:
                    btn = page.locator(sel).first
                    btn.wait_for(state="visible", timeout=5000)
                    with context.expect_page(timeout=5000) as new_page_info:
                        btn.click(timeout=5000)
                    page.wait_for_timeout(2000)
                    try:
                        new_page = new_page_info.value
                        new_page.wait_for_load_state("domcontentloaded", timeout=15000)
                        page = new_page
                        print(f"[SOCIAL][META] Composer opened in new tab via {sel} after scroll")
                    except Exception:
                        print(f"[SOCIAL][META] No new tab after scroll via {sel}")
                    create_clicked = True
                    break
                except Exception:
                    continue

    else:
        print("[SOCIAL][META] Composer already open; skipping Create post button.")

    print(f"[SOCIAL][META] Using composer page: {page.url}")
    page.wait_for_timeout(2000)

    # Dismiss any onboarding tips/toasts that might block the UI
    try:
        for label in ["Got it", "Skip", "Got It", "OK"]:
            tip = page.get_by_text(label, exact=True).first
            if tip.is_visible(timeout=1000):
                tip.click()
    except Exception:
        pass

    # Fill caption (text area visible on page)
    try:
        caption_locators = [
            page.locator("div[role='textbox'][contenteditable='true']").first,
            page.locator("div[role='textbox']").first,
            page.locator("div[role='textbox']").nth(1),
            page.locator("textarea").first,
            page.get_by_label("Text").locator("div[role='textbox']").first,
            page.locator("div[aria-label='Text']").first,
            page.locator("div[aria-multiline='true']").first,
        ]
        filled = False
        for cap in caption_locators:
            try:
                cap.scroll_into_view_if_needed(timeout=5000)
                cap.wait_for(state="visible", timeout=15000)
                cap.click(timeout=5000)
                cap.fill(task.caption or "")
                print(f"[SOCIAL][META] Caption filled for {task.attachment_path}")
                filled = True
                break
            except Exception:
                continue
        if not filled:
            print("[SOCIAL][META] Could not find a visible caption box.")
            return False
    except Exception as exc:
        print(f"[SOCIAL][META] Could not fill caption: {exc}")
        return False

    # Upload media
    upload_success = False
    triggers = [
        "button:has-text('Add photo/video')",
        "text=Add photo/video",
        "[aria-label='Add photo/video']",
        "span:has-text('Add photo/video')",
    ]
    for trig in triggers:
        try:
            locator = page.locator(trig).first
            locator.scroll_into_view_if_needed(timeout=5000)
            locator.wait_for(state="visible", timeout=15000)
            with page.expect_file_chooser(timeout=20000) as fc_info:
                locator.click()
            fc = fc_info.value
            fc.set_files(task.attachment_path)
            upload_success = True
            print(f"[SOCIAL][META] Uploaded image via {trig}")
            break
        except Exception:
            continue

    if not upload_success:
        try:
            file_input = page.locator("input[type='file']").first
            file_input.set_input_files(task.attachment_path, timeout=5000)
            upload_success = True
            print("[SOCIAL][META] Uploaded image via direct file input.")
        except Exception as exc:
            print(f"[SOCIAL][META] Could not upload image: {exc}")
            return False

    return True


def create_social_drafts(tasks: List[PostingTask]):
    """
    Open sheet and platform entrypoints with Playwright so the user can login and draft.
    """
    if not tasks:
        return

    print(f"[SOCIAL] Preparing {len(tasks)} draft task(s)...")
    for task in tasks:
        print(
            f"  - {task.company} | platforms: {task.platforms} | when: {task.scheduled_dt} | file: {task.attachment_path} | matched via: {task.matched_via}"
        )

    # Launch Playwright headful to let the user login and keep sessions.
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        print(f"[SOCIAL] Playwright not available: {exc}")
        return

    service = load_sheets_service()

    try:
        with sync_playwright() as p:
            meta_context = launch_chrome_profile(p, user_data_dir=CHROME_USER_DATA_DIR, channel="chrome")

            # Open tabs up-front and let the user log in before automation.
            tabs = {}
            try:
                tabs["sheet"] = meta_context.new_page()
                tabs["sheet"].goto(SHEET_BASE_URL, wait_until="domcontentloaded", timeout=30000)
                print("[SOCIAL] Opened Google Sheet for reference (best-effort).")
            except Exception as exc:
                print(f"[SOCIAL] Failed to open sheet in Playwright (ignored): {exc}")

            try:
                tabs["meta"] = meta_context.new_page()
                tabs["meta"].goto(FACEBOOK_PAGE_URL, wait_until="domcontentloaded", timeout=60000)
                print("[SOCIAL] Opened Facebook/Instagram entrypoint.")
            except Exception as exc:
                print(f"[SOCIAL] Failed to open Facebook/Instagram: {exc}")

            # Keep folders open to ease manual upload
            opened_dirs = set()
            for task in tasks:
                dir_path = os.path.dirname(task.attachment_path)
                if dir_path in opened_dirs:
                    continue
                open_folder(dir_path)
                opened_dirs.add(dir_path)

            # Process each task/platform
            for task in tasks:
                all_success = True
                errors = []
                supported = [p for p in task.platforms if p.strip().lower() in SUPPORTED_PLATFORMS]
                skipped_platforms = [p for p in task.platforms if p.strip().lower() not in SUPPORTED_PLATFORMS]

                if skipped_platforms:
                    errors.append(f"Skipped unsupported platform(s): {', '.join(skipped_platforms)}")

                for platform in supported:
                    pk = platform.strip().lower()
                    success = False
                    err_msg = ""
                    try:
                        success = create_meta_draft(meta_context, task, page=tabs.get("meta"))
                    except Exception as exc:
                        err_msg = f"Draft failed: {exc}"
                        success = False

                    if not success:
                        all_success = False
                        if err_msg:
                            errors.append(err_msg)

                if all_success:
                    record_status(service, task, True, "Draft successful")
                else:
                    msg = "; ".join(errors) if errors else "Draft failed"
                    record_status(service, task, False, msg)

            print("[SOCIAL] Drafts should now be open in the tabs. Review/schedule if needed, then press Enter here to close Playwright windows.")
            input()
            meta_context.close()
    except Exception as exc:
        print(f"[SOCIAL] Playwright run failed: {exc}")
        if service:
            for task in tasks:
                try:
                    record_status(service, task, False, f"Draft failed: {exc}")
                except Exception:
                    pass
def get_mail_by_entry_id(entry_id: str):
    outlook = win32com.client.Dispatch("Outlook.Application")
    ns = outlook.GetNamespace("MAPI")
    return ns.GetItemFromID(entry_id)


def is_inline_attachment(att, html_body: str) -> bool:
    """
    Best-effort detection of inline images so we don't save them as external files.
    Heuristics:
    - Attachment.Position > 0 typically means inline.
    - Content-ID present and referenced in the HTML body (cid:...).
    """
    try:
        if hasattr(att, "Position") and att.Position not in (-1, 0):
            return True
    except Exception:
        pass

    try:
        accessor = att.PropertyAccessor
        cid = accessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001E")
        if cid and f"cid:{cid}" in html_body:
            return True
    except Exception:
        pass

    return False


INLINE_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


def is_tiny_image_attachment(att) -> bool:
    """Skip tiny inline-looking images (common in signatures)."""
    try:
        size = getattr(att, "Size", 0) or 0
        name = getattr(att, "FileName", "") or ""
        ext = os.path.splitext(name)[1].lower()
        if ext in INLINE_IMAGE_EXTS and size > 0 and size <= INLINE_IMAGE_MAX_BYTES:
            return True
    except Exception:
        pass
    return False


def get_real_attachments(mail) -> List:
    """Return attachments filtered to exclude inline images."""
    real = []
    try:
        attachments = mail.Attachments
    except Exception:
        return real

    if not attachments:
        return real

    html_body = getattr(mail, "HTMLBody", "") or ""

    try:
        count = attachments.Count
    except Exception:
        return real

    for i in range(1, count + 1):
        try:
            att = attachments.Item(i)
        except Exception:
            continue

        try:
            if is_inline_attachment(att, html_body):
                continue
        except Exception:
            pass
        if is_tiny_image_attachment(att):
            continue
        real.append(att)

    return real


def _normalize_text(text: str) -> str:
    """Lowercase and collapse non-alphanumeric to spaces for easier matching."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def extract_clean_instruction_block(body: str) -> str:
    """
    Keep only the fresh instruction area of an email.
    This avoids routing from quoted replies, signatures, and forwarded chains.
    """
    if not body:
        return ""

    stop_patterns = [
        r"^\s*-{2,}\s*original message\s*-{2,}\s*$",
        r"^\s*from:\s+",
        r"^\s*sent:\s+",
        r"^\s*to:\s+",
        r"^\s*subject:\s+",
        r"^\s*on .+ wrote:\s*$",
        r"^\s*kind regards\b",
        r"^\s*best regards\b",
        r"^\s*regards\b",
        r"^\s*thank you[.!]?\s*$",
        r"^\s*thanks[.!]?\s*$",
        r"^\s*baie dankie[.!]?\s*$",
    ]
    lines: List[str] = []
    for raw_line in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        if any(re.match(pattern, line, flags=re.IGNORECASE) for pattern in stop_patterns):
            break
        lines.append(line)

    cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _alias_is_weak(alias: str) -> bool:
    return _normalize_text(alias) in WEAK_ALIASES


def _company_alias_hits(text: str, subject: str = "", include_weak: bool = True) -> List[str]:
    search_space = f" {_normalize_text(text)} {_normalize_text(subject)} "
    found: List[str] = []
    seen = set()

    for entry in _company_catalog():
        canonical = str(entry["name"])
        aliases = entry["aliases"]
        for alias in aliases:
            if _alias_is_weak(str(alias)) and not include_weak:
                continue
            norm_alias = f" {_normalize_text(str(alias))} "
            if norm_alias.strip() and norm_alias in search_space:
                if canonical not in seen:
                    seen.add(canonical)
                    found.append(canonical)
                break

    return found


def _structured_company_targets(text: str, subject: str = "") -> List[str]:
    targets: List[str] = []
    seen = set()
    patterns = [
        r"^\s*(?:company|client|page|account|dealership|branch)\s*[:\-]\s*(.+?)\s*$",
        r"^\s*(?:for|schedule for|post for)\s*[:\-]\s*(.+?)\s*$",
    ]
    candidates = [subject] + text.splitlines()[:12]

    for line in candidates:
        for pattern in patterns:
            match = re.match(pattern, line or "", flags=re.IGNORECASE)
            if not match:
                continue
            hits = _company_alias_hits(match.group(1), include_weak=True)
            for hit in hits:
                if hit not in seen:
                    seen.add(hit)
                    targets.append(hit)

    return targets


def detect_laubstar_shared_route(text: str, subject: str = "") -> bool:
    search_space = f" {_normalize_text(text)} {_normalize_text(subject)} "
    if any(f" {trigger} " in search_space for trigger in LAUBSTAR_SHARED_TRIGGERS):
        return True
    detected = set(_company_alias_hits(text, subject, include_weak=True))
    return len(detected.intersection(LAUBSTAR_SHARED_MEMBERS)) >= 2


def starts_with_baie_dankie_ack(body: str) -> bool:
    """
    Return True if the first two alphabetic words are combinations of 'baie'/'dankie'.
    """
    if not body:
        return False

    words = re.findall(r"[a-z]+", body.lower())
    if len(words) < 2:
        return False

    first_two = words[:2]
    return all(word in BAIE_ACK_ALLOWED_WORDS for word in first_two)


def mark_mail_read_and_complete_flag(mail) -> bool:
    try:
        mail.UnRead = False
        try:
            mail.TaskComplete = True
        except Exception:
            pass
        try:
            mail.FlagStatus = 1  # olFlagComplete
        except Exception:
            pass
        mail.Save()
        return True
    except pywintypes.com_error as exc:
        print(f"[OUTLOOK] COM error updating mail: {exc}")
        return False
    except Exception:
        return False


def extract_companies_from_body(body: str, subject: str = "") -> List[str]:
    """
    Match against known companies in the fresh instruction block and subject.
    Weak aliases are only used as fallback evidence, so quoted/contextual words
    like "Mahindra" or "East London" don't overpower stronger page names.
    Returns canonical company names in order of detection.
    """
    clean_body = extract_clean_instruction_block(body)
    found: List[str] = []
    seen = set()

    for group in (
        _structured_company_targets(clean_body, subject),
        _company_alias_hits(clean_body, subject, include_weak=False),
        _company_alias_hits(clean_body, subject, include_weak=True),
    ):
        for canonical in group:
            if canonical not in seen:
                seen.add(canonical)
                found.append(canonical)

    if detect_laubstar_shared_route(clean_body, subject) and LAUBSTAR_SHARED_COMPANY_NAME not in seen:
        found.insert(0, LAUBSTAR_SHARED_COMPANY_NAME)

    return found


def safe_folder_name(name: str) -> str:
    """Remove characters not allowed in Windows folder names."""
    return re.sub(r'[<>:"/\\\\|?*]', "", name).strip()


def build_dest_folder(mail, company_name: str, run_hint: Optional[str] = None, create: bool = True) -> str:
    """Create a (optionally deterministic) destination folder for this mail/company combo."""
    date_str = mail.ReceivedTime.Format("%Y-%m-%d")
    year_str = mail.ReceivedTime.Format("%Y")

    folder_name = safe_folder_name(company_name)
    root = os.path.join(BASE_PATH, year_str, folder_name, date_str)
    if create:
        os.makedirs(root, exist_ok=True)

    if run_hint:
        hash_input = f"{run_hint}-{company_name}-{date_str}"
        run_id = hashlib.sha1(hash_input.encode("utf-8", errors="ignore")).hexdigest()[:8]
        dest = os.path.join(root, run_id)
        if create:
            os.makedirs(dest, exist_ok=True)
        return dest

    # Use a short UUID to avoid collisions when multiple mails arrive simultaneously.
    for _ in range(5):
        run_id = uuid.uuid4().hex[:8]
        candidate = os.path.join(root, run_id)
        try:
            if create:
                os.makedirs(candidate)
            return candidate
        except FileExistsError:
            continue

    raise RuntimeError(f"Could not create unique folder under {root}")


def choose_company_for_attachment(filename: str, companies: List[str], context_text: str = "") -> Tuple[str, int]:
    fname_tokens = _normalize_text(filename)
    context_tokens = _normalize_text(context_text)
    best = companies[0]  # default to first
    best_score = 0

    for name in companies:
        tokens = [t.lower() for t in _normalize_text(name).split() if len(t) > 2]
        filename_score = sum(1 for t in tokens if t in fname_tokens)
        context_score = sum(1 for t in tokens if t in context_tokens)
        score = (filename_score * 2) + context_score  # prefer filename hits
        if score > best_score:
            best_score = score
            best = name

    return best, best_score


def ai_api_key() -> Optional[str]:
    return (
        os.environ.get("AUTOPOST_OPENAI_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
        or None
    )


def ai_routing_available() -> bool:
    return AI_ROUTING_ENABLED and bool(ai_api_key())


def safe_attachment_filename(name: str) -> str:
    basename = os.path.basename(name or "").strip()
    if not basename:
        basename = f"attachment-{uuid.uuid4().hex[:8]}"
    return re.sub(r'[<>:"/\\\\|?*]', "_", basename)


def unique_file_path(folder: str, filename: str) -> str:
    os.makedirs(folder, exist_ok=True)
    safe_name = safe_attachment_filename(filename)
    candidate = os.path.join(folder, safe_name)
    if not os.path.exists(candidate):
        return candidate

    stem, ext = os.path.splitext(safe_name)
    for index in range(1, 1000):
        candidate = os.path.join(folder, f"{stem}-{index}{ext}")
        if not os.path.exists(candidate):
            return candidate
    raise RuntimeError(f"Could not create unique filename for {safe_name}")


def build_staging_folder(mail, run_hint: str, create: bool = True) -> str:
    date_str = mail.ReceivedTime.Format("%Y-%m-%d")
    year_str = mail.ReceivedTime.Format("%Y")
    run_id = hashlib.sha1(f"{run_hint}-{date_str}-staging".encode("utf-8", errors="ignore")).hexdigest()[:8]
    folder = os.path.join(BASE_PATH, year_str, "_routing_staging", date_str, run_id)
    if create:
        os.makedirs(folder, exist_ok=True)
    return folder


def build_quarantine_folder(mail, run_hint: str, create: bool = True) -> str:
    date_str = mail.ReceivedTime.Format("%Y-%m-%d")
    year_str = mail.ReceivedTime.Format("%Y")
    run_id = hashlib.sha1(f"{run_hint}-{date_str}-quarantine".encode("utf-8", errors="ignore")).hexdigest()[:8]
    folder = os.path.join(BASE_PATH, year_str, QUARANTINE_FOLDER_NAME, date_str, run_id)
    if create:
        os.makedirs(folder, exist_ok=True)
    return folder


def media_kind_for_path(path_or_name: str) -> str:
    ext = os.path.splitext(path_or_name or "")[1].lower()
    if ext in ROUTABLE_VIDEO_EXTS:
        return "video"
    if ext in ROUTABLE_IMAGE_EXTS:
        return "image"
    return "file"


def _image_file_to_data_url(image_path: str) -> Optional[str]:
    try:
        size = os.path.getsize(image_path)
    except OSError:
        return None

    source_path = image_path
    temp_path: Optional[str] = None
    if size > AI_MAX_IMAGE_BYTES:
        try:
            from PIL import Image

            with Image.open(image_path) as image:
                image.thumbnail((1400, 1400))
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                handle = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
                temp_path = handle.name
                handle.close()
                image.save(temp_path, "JPEG", quality=82, optimize=True)
                source_path = temp_path
        except Exception as exc:
            print(f"[AI ROUTING] Could not resize image for AI ({image_path}): {exc}")
            return None

    try:
        with open(source_path, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode("ascii")
        mime_type = mimetypes.guess_type(source_path)[0] or "image/jpeg"
        return f"data:{mime_type};base64,{encoded}"
    except Exception as exc:
        print(f"[AI ROUTING] Could not encode image for AI ({image_path}): {exc}")
        return None
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def extract_video_thumbnail_for_ai(video_path: str) -> Optional[str]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    thumb_path = handle.name
    handle.close()
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-vf",
                "scale=960:-1",
                thumb_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            return thumb_path
    except Exception:
        pass

    try:
        os.unlink(thumb_path)
    except OSError:
        pass
    return None


def media_data_url_for_ai(media_path: Optional[str]) -> Optional[str]:
    if not media_path or not os.path.exists(media_path):
        return None

    kind = media_kind_for_path(media_path)
    if kind == "image":
        return _image_file_to_data_url(media_path)
    if kind == "video":
        thumbnail = extract_video_thumbnail_for_ai(media_path)
        if not thumbnail:
            return None
        try:
            return _image_file_to_data_url(thumbnail)
        finally:
            try:
                os.unlink(thumbnail)
            except OSError:
                pass
    return None


def extract_response_text(payload: Dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str):
        return output_text

    for item in payload.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) or []:
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str):
                    return text
    return ""


def normalize_ai_target_company(value: str | None) -> Optional[str]:
    cleaned = (value or "").strip()
    if not cleaned or cleaned.upper() in {"QUARANTINE", "NEEDS_REVIEW", "NEEDS REVIEW"}:
        return None

    allowed = {str(entry["name"]): str(entry["name"]) for entry in _company_catalog()}
    allowed[LAUBSTAR_SHARED_COMPANY_NAME] = LAUBSTAR_SHARED_COMPANY_NAME
    normalized_allowed = {_normalize_text(name): canonical for name, canonical in allowed.items()}
    direct = normalized_allowed.get(_normalize_text(cleaned))
    if direct:
        return direct

    hits = _company_alias_hits(cleaned, include_weak=True)
    if len(hits) == 1:
        return hits[0]
    return None


def openai_route_media(
    *,
    subject: str,
    instruction_text: str,
    filename: str,
    media_path: Optional[str],
    detected_companies: List[str],
) -> Optional[RoutingDecision]:
    key = ai_api_key()
    if not key:
        return None

    catalog = [
        {"name": str(entry["name"]), "aliases": [str(alias) for alias in entry["aliases"]]}
        for entry in _company_catalog()
    ]
    data_url = media_data_url_for_ai(media_path)
    media_kind = media_kind_for_path(media_path or filename)
    prompt = {
        "subject": subject,
        "clean_instruction_text": instruction_text,
        "filename": filename,
        "media_kind": media_kind,
        "detected_companies_from_text": detected_companies,
        "allowed_targets": catalog,
        "special_rules": [
            {
                "target_company": LAUBSTAR_SHARED_COMPANY_NAME,
                "rule": (
                    "If the instruction says UD Group, UD Trucks Group, Laubstar Group, or schedule for Laubstar "
                    "and the media appears to belong to the Lichtenburg, Upington, Klerksdorp, or Kathu branch set, "
                    f"route to {LAUBSTAR_SHARED_COMPANY_NAME} so the campaign stays in one folder."
                ),
            },
            {
                "target_company": "QUARANTINE",
                "rule": "Use QUARANTINE if visual/text evidence conflicts or the exact target page is unclear.",
            },
        ],
    }
    content: List[Dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                "Route this email attachment to exactly one allowed target company/page. "
                "Use the clean instruction text, filename, and image/video thumbnail when present. "
                "Confidence is 0-5. Return QUARANTINE if uncertain."
                f"\n\nRouting input:\n{json.dumps(prompt, ensure_ascii=False)}"
            ),
        }
    ]
    if data_url:
        content.append({"type": "input_image", "image_url": data_url, "detail": "low"})

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "target_company": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 5},
            "reason": {"type": "string"},
            "alternatives": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["target_company", "confidence", "reason", "alternatives"],
    }
    request_payload = {
        "model": AI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You are a conservative social-media asset router. "
                            "Never invent a company. Pick only from allowed_targets or QUARANTINE. "
                            "Prefer explicit clean instruction text, then filename, then visual evidence. "
                            "If multiple companies are plausible and the media does not clearly identify one, lower confidence."
                        ),
                    }
                ],
            },
            {"role": "user", "content": content},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "autopost_media_route",
                "schema": schema,
                "strict": True,
            }
        },
    }

    try:
        req = urllib_request.Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(request_payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=AI_TIMEOUT_SECONDS) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        try:
            error_text = exc.read().decode("utf-8", errors="replace")
        except Exception:
            error_text = str(exc)
        print(f"[AI ROUTING] OpenAI routing failed for {filename}: {error_text[:500]}")
        return None
    except Exception as exc:
        print(f"[AI ROUTING] OpenAI routing failed for {filename}: {exc}")
        return None

    text = extract_response_text(response_payload)
    try:
        result = json.loads(text)
    except Exception:
        print(f"[AI ROUTING] Could not parse AI routing JSON for {filename}: {text[:500]}")
        return None

    target = normalize_ai_target_company(result.get("target_company"))
    confidence = float(result.get("confidence") or 0)
    alternatives = [str(item) for item in result.get("alternatives", []) if str(item).strip()]
    return RoutingDecision(
        target_company=target,
        confidence=confidence,
        method="ai",
        reason=str(result.get("reason") or "AI routing decision."),
        candidates=detected_companies,
        alternatives=alternatives,
        raw_ai=result,
    )


def route_media_file(
    *,
    subject: str,
    instruction_text: str,
    filename: str,
    media_path: Optional[str],
    detected_companies: List[str],
) -> RoutingDecision:
    text_targets = list(dict.fromkeys(detected_companies))
    filename_targets = _company_alias_hits(filename, include_weak=True)
    candidates = list(dict.fromkeys(text_targets + filename_targets))

    non_laubstar_candidates = [
        c for c in candidates
        if c not in LAUBSTAR_SHARED_MEMBERS
        and c not in {LAUBSTAR_SHARED_COMPANY_NAME, "Laubstar", "FAW Trucks LBS"}
    ]
    if detect_laubstar_shared_route(instruction_text, subject) and not non_laubstar_candidates:
        return RoutingDecision(
            target_company=LAUBSTAR_SHARED_COMPANY_NAME,
            confidence=5.0,
            method="deterministic",
            reason="Clean instruction text indicates a UD Group/Laubstar shared campaign.",
            candidates=candidates,
            alternatives=[],
        )

    if len(text_targets) == 1 and not filename_targets:
        return RoutingDecision(
            target_company=text_targets[0],
            confidence=5.0,
            method="deterministic",
            reason="Only one company/page was detected in the clean instruction text.",
            candidates=candidates,
            alternatives=[],
        )

    if len(text_targets) == 1 and set(filename_targets).issubset(set(text_targets)):
        return RoutingDecision(
            target_company=text_targets[0],
            confidence=5.0,
            method="deterministic",
            reason="Clean instruction text and filename point to the same company/page.",
            candidates=candidates,
            alternatives=[],
        )

    if not text_targets and len(filename_targets) == 1:
        return RoutingDecision(
            target_company=filename_targets[0],
            confidence=4.2,
            method="filename",
            reason="Filename points to one company/page and no clean text target conflicts.",
            candidates=candidates,
            alternatives=[],
        )

    if len(filename_targets) == 1 and filename_targets[0] in text_targets:
        return RoutingDecision(
            target_company=filename_targets[0],
            confidence=4.6,
            method="filename",
            reason="Clean instruction text lists multiple pages, but the filename points to one listed page.",
            candidates=candidates,
            alternatives=[candidate for candidate in candidates if candidate != filename_targets[0]],
        )

    ai_decision = openai_route_media(
        subject=subject,
        instruction_text=instruction_text,
        filename=filename,
        media_path=media_path,
        detected_companies=candidates,
    )
    if ai_decision:
        return ai_decision

    if len(candidates) == 1:
        return RoutingDecision(
            target_company=candidates[0],
            confidence=4.1,
            method="fallback",
            reason="AI unavailable; one candidate remained after clean text and filename matching.",
            candidates=candidates,
            alternatives=[],
        )

    return RoutingDecision(
        target_company=None,
        confidence=0.0,
        method="quarantine",
        reason="Routing is ambiguous and AI routing was unavailable or inconclusive.",
        candidates=candidates,
        alternatives=candidates,
    )


def write_routing_audit(path: str, decision: RoutingDecision, *, subject: str, instruction_text: str, original_filename: str) -> None:
    if not ROUTING_AUDIT_ENABLED and not decision.should_quarantine:
        return

    audit = {
        "original_filename": original_filename,
        "saved_path": path,
        "target_company": decision.target_company,
        "confidence": decision.confidence,
        "threshold": AI_CONFIDENCE_THRESHOLD,
        "method": decision.method,
        "reason": decision.reason,
        "candidates": decision.candidates,
        "alternatives": decision.alternatives,
        "subject": subject,
        "clean_instruction_text": instruction_text,
        "raw_ai": decision.raw_ai,
        "quarantined": decision.should_quarantine,
    }
    audit_path = f"{path}.routing.json"
    try:
        with open(audit_path, "w", encoding="utf-8") as fh:
            json.dump(audit, fh, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[AI ROUTING] Could not write routing audit for {path}: {exc}")


def open_folder(path: str) -> None:
    """Open a folder in Explorer (best-effort)."""
    if not os.path.isdir(path):
        print(f"Folder not found, cannot open: {path}")
        return
    try:
        os.startfile(path)
    except Exception as exc:
        print(f"Could not open folder {path}: {exc}")


def process_mail(entry_id: str, dry_run: bool = False) -> bool:
    mail = get_mail_by_entry_id(entry_id)
    if mail is None:
        print(f"[{entry_id}] Mail not found (EntryID).")
        return False

    body = mail.Body or ""
    subject = mail.Subject or ""
    clean_instruction = extract_clean_instruction_block(body)
    companies = extract_companies_from_body(clean_instruction, subject)

    if not companies and not ai_routing_available():
        print(f"[{entry_id}] No companies detected from body/subject, nothing to do.")
        return False

    # Filter out inline images (best effort)
    real_attachments = get_real_attachments(mail)

    if len(real_attachments) == 0:
        print(f"[{entry_id}] No non-inline attachments on this mail.")
        return False

    print(f"[{entry_id}] Detected companies from clean instructions: {companies or '[none]'}")
    if ai_routing_available():
        print(f"[{entry_id}] AI media routing is enabled with model {AI_MODEL}.")
    else:
        print(f"[{entry_id}] AI media routing unavailable; set OPENAI_API_KEY or AUTOPOST_OPENAI_API_KEY to enable it.")
    if dry_run:
        print(f"[{entry_id}] Dry-run mode: will not save attachments or update Sheets/Outlook.")

    dest_folders = set()
    company_to_paths: Dict[str, List[str]] = {}
    staging_folder = build_staging_folder(mail, entry_id, create=not dry_run)

    try:
        for att in real_attachments:
            fname = safe_attachment_filename(getattr(att, "FileName", "") or "")
            if dry_run:
                staged_path = os.path.join(staging_folder, fname)
                staged_for_ai = None
            else:
                staged_path = unique_file_path(staging_folder, fname)
                att.SaveAsFile(staged_path)
                staged_for_ai = staged_path

            decision = route_media_file(
                subject=subject,
                instruction_text=clean_instruction,
                filename=fname,
                media_path=staged_for_ai,
                detected_companies=companies,
            )

            if decision.should_quarantine:
                dest_folder = build_quarantine_folder(mail, entry_id, create=not dry_run)
                dest_label = QUARANTINE_FOLDER_NAME
            else:
                dest_folder = build_dest_folder(mail, decision.target_company or QUARANTINE_FOLDER_NAME, run_hint=entry_id, create=not dry_run)
                dest_label = decision.target_company or QUARANTINE_FOLDER_NAME

            dest_folders.add(dest_folder)
            save_path = unique_file_path(dest_folder, fname) if not dry_run else os.path.join(dest_folder, fname)
            if dry_run:
                print(
                    f"  [{entry_id}] (dry-run) {fname} -> {dest_label} "
                    f"(confidence={decision.confidence:.1f}, method={decision.method}) => {save_path}"
                )
                if not decision.should_quarantine:
                    company_to_paths.setdefault(dest_label, []).append(save_path)
                continue

            shutil.move(staged_path, save_path)
            write_routing_audit(save_path, decision, subject=subject, instruction_text=clean_instruction, original_filename=fname)
            print(
                f"  [{entry_id}] {fname} -> {dest_label} "
                f"(confidence={decision.confidence:.1f}, method={decision.method}) => {save_path}"
            )
            if decision.should_quarantine:
                print(f"    [{entry_id}] Quarantined: {decision.reason}")
            else:
                company_to_paths.setdefault(dest_label, []).append(save_path)
    except Exception as exc:
        print(f"[{entry_id}] Failed to save attachments: {exc}")
        return False
    finally:
        if not dry_run:
            try:
                os.rmdir(staging_folder)
            except OSError:
                pass

    if not dry_run:
        try:
            mail.UnRead = False
            mail.Save()
            print(f"[{entry_id}] Marked mail as read.")
        except pywintypes.com_error as exc:
            print(f"[{entry_id}] Processed but could not mark as read (COM error): {exc}")
        except Exception as exc:
            print(f"[{entry_id}] Processed but could not mark as read: {exc}")

    for company_name, paths in company_to_paths.items():
        if dry_run:
            continue
        tasks = build_tasks_from_sheet(company_name, paths)
        if tasks:
            create_social_drafts(tasks)

    for folder in dest_folders:
        if dry_run:
            print(f"[{entry_id}] (dry-run) Would open folder: {folder}")
        else:
            print(f"[{entry_id}] Opening folder: {folder}")
            open_folder(folder)

    if company_to_paths:
        print(f"[{entry_id}] Summary:")
        for company_name, paths in company_to_paths.items():
            print(f"  {company_name}: {len(paths)} file(s)")
            for p in paths:
                print(f"    - {p}")

    return True


def process_baie_dankie_acknowledgements(clarise_folder=None, dry_run: bool = False):
    """
    Scan Clarise folder for unread 'Baie Dankie' acknowledgements and complete them.
    """
    target_folder = clarise_folder
    if target_folder is None:
        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            ns = outlook.GetNamespace("MAPI")
            inbox = ns.GetDefaultFolder(6)
            target_folder = inbox.Folders(CLARISE_FOLDER_NAME)
        except Exception as exc:
            print(f"[BAIE] Could not access {CLARISE_FOLDER_NAME} folder: {exc}")
            return

    try:
        items = target_folder.Items
    except Exception as exc:
        print(f"[BAIE] Could not read items in {CLARISE_FOLDER_NAME}: {exc}")
        return

    processed = 0

    for item in items:
        try:
            if item.Class != 43 or not item.UnRead:
                continue
            sender = (getattr(item, "SenderEmailAddress", "") or "").lower()
            if sender != CLARISE_SENDER_EMAIL:
                continue
            body = item.Body or ""
        except Exception:
            continue

        if not starts_with_baie_dankie_ack(body):
            continue

        if get_real_attachments(item):
            # Ignore if there are real attachments; treat via main workflow
            continue

        entry_id = getattr(item, "EntryID", "UNKNOWN")
        if dry_run:
            processed += 1
            print(f"[{entry_id}] (dry-run) Would auto-complete 'Baie Dankie' acknowledgement.")
            continue
        if mark_mail_read_and_complete_flag(item):
            processed += 1
            print(f"[{entry_id}] Auto-completed 'Baie Dankie' acknowledgement.")
        else:
            print(f"[{entry_id}] Could not update 'Baie Dankie' acknowledgement.")

    if processed:
        print(f"[INFO] Cleared {processed} 'Baie Dankie' acknowledgement(s).")


def process_unread_clarise_folder(dry_run: bool = False):
    """Fallback mode: scan Clarise folder for unread mails from Clarise and process each."""
    outlook = win32com.client.Dispatch("Outlook.Application")
    ns = outlook.GetNamespace("MAPI")
    inbox = ns.GetDefaultFolder(6)  # olFolderInbox
    clarise_folder = inbox.Folders(CLARISE_FOLDER_NAME)  # folder name must match

    entry_ids = []

    for item in clarise_folder.Items:
        if item.Class == 43:  # olMailItem
            if item.UnRead and item.SenderEmailAddress.lower() == CLARISE_SENDER_EMAIL:
                entry_ids.append(item.EntryID)

    if not entry_ids:
        print("[INFO] No unread emails from Clarise in Clarise folder.")
        process_baie_dankie_acknowledgements(clarise_folder, dry_run=dry_run)
        return

    print(f"[INFO] Found {len(entry_ids)} unread Clarise emails. Processing...")
    for eid in entry_ids:
        print(f"\n--- Processing {eid} ---")
        process_mail(eid, dry_run=dry_run)

    process_baie_dankie_acknowledgements(clarise_folder, dry_run=dry_run)


def print_startup_diagnostics() -> None:
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"[CONFIG] Sheets service account file is missing: {SERVICE_ACCOUNT_FILE}")
    print(f"[CONFIG] ACTIVE_COMPANY_ONLY = {ACTIVE_COMPANY_ONLY}")
    print(f"[CONFIG] AUTOPOST_BASE_PATH = {BASE_PATH}")
    print(f"[CONFIG] AI routing = {'enabled' if ai_routing_available() else 'disabled'} ({AI_MODEL})")
    print(f"[CONFIG] Quarantine folder = {QUARANTINE_FOLDER_NAME}, threshold = {AI_CONFIDENCE_THRESHOLD}")


def main():
    print_startup_diagnostics()
    args = sys.argv[1:]
    dry_run = False
    entry_ids: List[str] = []

    for arg in args:
        if arg == "--dry-run":
            dry_run = True
        else:
            entry_ids.append(arg)

    # If no EntryIDs provided: scan Clarise folder for unread mails
    if not entry_ids:
        process_unread_clarise_folder(dry_run=dry_run)
        return

    successes = 0
    for entry_id in entry_ids:
        print(f"\n--- Processing {entry_id} ---")
        if process_mail(entry_id, dry_run=dry_run):
            successes += 1

    print(f"\nCompleted {successes}/{len(entry_ids)} email(s).")
    process_baie_dankie_acknowledgements(dry_run=dry_run)


if __name__ == "__main__":
    main()
