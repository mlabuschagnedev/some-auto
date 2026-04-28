import os
import sys
import re
import uuid
import json
import hashlib
import datetime
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple

from zoneinfo import ZoneInfo
from google.oauth2 import service_account
from googleapiclient.discovery import build
import win32com.client
import pywintypes

BASE_PATH = os.environ.get("AUTOPOST_BASE_PATH", r"C:\AutoPosts")
Reviewer_FOLDER_NAME = "Reviewer"
Reviewer_SENDER_EMAIL = "Example@sample.co.za"
BAIE_ACK_ALLOWED_WORDS = {"baie", "dankie"}
SERVICE_ACCOUNT_FILE = os.environ.get(
    "AUTOPOST_GOOGLE_SERVICE_ACCOUNT", r"E:\Example\Documents\Coding-Projects\SoMe-Auto\example-service-account.json"
)
SHEET_ID = os.environ.get("AUTOPOST_SHEET_ID", "sample-google-sheet-id")
# The only active company for now; everything else is left wired but inactive.
ACTIVE_COMPANY_ONLY = os.environ.get("AUTOPOST_ACTIVE_COMPANY_ONLY", "Sample Brand A")
TZ = ZoneInfo("Africa/Johannesburg")
TARGET_GREEN_RGB = (52, 168, 83)
INLINE_IMAGE_MAX_BYTES = int(os.environ.get("AUTOPOST_INLINE_IMAGE_MAX_BYTES", 5 * 1024))
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
    "Sample Branch Long Name": "Sample Branch",
}
PLATFORM_URLS = {
    "facebook": "https://business.facebook.com/latest/home",
    "instagram": "https://business.facebook.com/latest/home",
    "linkedin": "https://www.linkedin.com/feed/",
}
SHEET_BASE_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
FACEBOOK_PAGE_ID = os.environ.get("AUTOPOST_FACEBOOK_PAGE_ID", "123456789012345")
FACEBOOK_PAGE_URL = os.environ.get(
    "AUTOPOST_FACEBOOK_PAGE_URL",
    f"https://business.facebook.com/latest/home?asset_id={FACEBOOK_PAGE_ID}",
)

# Known companies with aliases for robust matching

# Known companies with aliases for robust matching
COMPANIES: List[Dict[str, str | List[str]]] = [
    {"name": "Sample Brand A", "aliases": ["Sample Brand A", "Sample A"]},
    {"name": "Sample Brand B", "aliases": ["Sample Brand B", "Sample B"]},
    {"name": "Sample Branch", "aliases": ["Sample Branch", "Branch A"]},
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
    Match against a catalog of known companies/aliases in body and subject.
    Returns canonical company names in order of detection.
    """
    catalog = _company_catalog()
    search_space = f" {_normalize_text(body)} {_normalize_text(subject)} "
    found: List[str] = []
    seen = set()

    for entry in catalog:
        canonical = entry["name"]
        aliases = entry["aliases"]
        for alias in aliases:
            norm_alias = f" {_normalize_text(alias)} "
            if norm_alias and norm_alias in search_space:
                if canonical not in seen:
                    seen.add(canonical)
                    found.append(canonical)
                break

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
    companies = extract_companies_from_body(body, subject)

    if not companies:
        print(f"[{entry_id}] No companies detected from body/subject, nothing to do.")
        return False

    # Filter out inline images (best effort)
    real_attachments = get_real_attachments(mail)

    if len(real_attachments) == 0:
        print(f"[{entry_id}] No non-inline attachments on this mail.")
        return False

    context_text = f"{subject} {body}"

    print(f"[{entry_id}] Detected companies: {companies}")
    if dry_run:
        print(f"[{entry_id}] Dry-run mode: will not save attachments or update Sheets/Outlook.")

    multi_companies = len(companies) > 1 and len(real_attachments) > 1

    dest_folders = set()
    company_to_paths: Dict[str, List[str]] = {}
    attachments_by_company: Dict[str, List] = {}
    attachment_choices: List[Tuple] = []
    company_hits: Dict[str, int] = {name: 0 for name in companies}

    try:
        if multi_companies:
            print(f"[{entry_id}] Multiple companies + attachments, routing by filename...")
            for att in real_attachments:
                fname = att.FileName
                company_name, score = choose_company_for_attachment(fname, companies, context_text=context_text)
                attachment_choices.append((att, company_name, score))
                if score > 0:
                    company_hits[company_name] = company_hits.get(company_name, 0) + 1
                print(f"  [{entry_id}] {fname} mapped to {company_name} (score={score})")
            positive_companies = [c for c, hits in company_hits.items() if hits > 0]
            if len(positive_companies) == 1:
                forced = positive_companies[0]
                attachments_by_company[forced] = [att for att, _, _ in attachment_choices]
                print(f"  [{entry_id}] Only {forced} matched by content; routing all attachments there.")
            else:
                for att, company_name, _score in attachment_choices:
                    attachments_by_company.setdefault(company_name, []).append(att)
        else:
            company_name = companies[0]
            attachments_by_company[company_name] = real_attachments

        for company_name, attachments in attachments_by_company.items():
            dest = build_dest_folder(mail, company_name, run_hint=entry_id, create=not dry_run)
            dest_folders.add(dest)
            for att in attachments:
                fname = att.FileName
                save_path = os.path.join(dest, fname)
                if dry_run:
                    print(f"  [{entry_id}] (dry-run) {fname} -> {company_name} => {save_path}")
                    company_to_paths.setdefault(company_name, []).append(save_path)
                    continue
                try:
                    att.SaveAsFile(save_path)
                    print(f"  [{entry_id}] {fname} -> {company_name} => {save_path}")
                    company_to_paths.setdefault(company_name, []).append(save_path)
                except Exception as exc:
                    print(f"[{entry_id}] Failed to save {fname} to {save_path}: {exc}")
    except Exception as exc:
        print(f"[{entry_id}] Failed to save attachments: {exc}")
        return False

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


def process_baie_dankie_acknowledgements(Reviewer_folder=None, dry_run: bool = False):
    """
    Scan Reviewer folder for unread 'Baie Dankie' acknowledgements and complete them.
    """
    target_folder = Reviewer_folder
    if target_folder is None:
        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            ns = outlook.GetNamespace("MAPI")
            inbox = ns.GetDefaultFolder(6)
            target_folder = inbox.Folders(Reviewer_FOLDER_NAME)
        except Exception as exc:
            print(f"[BAIE] Could not access {Reviewer_FOLDER_NAME} folder: {exc}")
            return

    try:
        items = target_folder.Items
    except Exception as exc:
        print(f"[BAIE] Could not read items in {Reviewer_FOLDER_NAME}: {exc}")
        return

    processed = 0

    for item in items:
        try:
            if item.Class != 43 or not item.UnRead:
                continue
            sender = (getattr(item, "SenderEmailAddress", "") or "").lower()
            if sender != Reviewer_SENDER_EMAIL:
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


def process_unread_Reviewer_folder(dry_run: bool = False):
    """Fallback mode: scan Reviewer folder for unread mails from Reviewer and process each."""
    outlook = win32com.client.Dispatch("Outlook.Application")
    ns = outlook.GetNamespace("MAPI")
    inbox = ns.GetDefaultFolder(6)  # olFolderInbox
    Reviewer_folder = inbox.Folders(Reviewer_FOLDER_NAME)  # folder name must match

    entry_ids = []

    for item in Reviewer_folder.Items:
        if item.Class == 43:  # olMailItem
            if item.UnRead and item.SenderEmailAddress.lower() == Reviewer_SENDER_EMAIL:
                entry_ids.append(item.EntryID)

    if not entry_ids:
        print("[INFO] No unread emails from Reviewer in Reviewer folder.")
        process_baie_dankie_acknowledgements(Reviewer_folder, dry_run=dry_run)
        return

    print(f"[INFO] Found {len(entry_ids)} unread Reviewer emails. Processing...")
    for eid in entry_ids:
        print(f"\n--- Processing {eid} ---")
        process_mail(eid, dry_run=dry_run)

    process_baie_dankie_acknowledgements(Reviewer_folder, dry_run=dry_run)


def print_startup_diagnostics() -> None:
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"[CONFIG] Sheets service account file is missing: {SERVICE_ACCOUNT_FILE}")
    print(f"[CONFIG] ACTIVE_COMPANY_ONLY = {ACTIVE_COMPANY_ONLY}")
    print(f"[CONFIG] AUTOPOST_BASE_PATH = {BASE_PATH}")


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

    # If no EntryIDs provided: scan Reviewer folder for unread mails
    if not entry_ids:
        process_unread_Reviewer_folder(dry_run=dry_run)
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

