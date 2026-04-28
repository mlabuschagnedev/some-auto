from __future__ import annotations

from . import app as core
from .media import *
from .models import Page, PlanningRow, PlanningSheet, db
from .publishing import *
from .settings import *

Any = core.Any
EMAIL_FROM = core.EMAIL_FROM
EMAIL_TO = core.EMAIL_TO
Path = core.Path
PLANNING_Reviewer_REQUIRED_FIELDS = core.PLANNING_Reviewer_REQUIRED_FIELDS
PLANNING_Reviewer_SENT_COLOR = core.PLANNING_Reviewer_SENT_COLOR
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
PLANNING_IMPORT_INBOX_DIR = core.PLANNING_IMPORT_INBOX_DIR
PLANNING_IMPORT_PROCESSED_DIR = core.PLANNING_IMPORT_PROCESSED_DIR
PLANNING_READY_COLOR = core.PLANNING_READY_COLOR
PLANNING_READY_WARNING_LEAD_HOURS = core.PLANNING_READY_WARNING_LEAD_HOURS
PLANNING_WARNING_LEAD_HOURS = core.PLANNING_WARNING_LEAD_HOURS
SMTP_DEBUG = core.SMTP_DEBUG
SMTP_PASS = core.SMTP_PASS
SMTP_PORT = core.SMTP_PORT
SMTP_SECURITY = core.SMTP_SECURITY
SMTP_SERVER = core.SMTP_SERVER
SMTP_TRY_FALLBACK = core.SMTP_TRY_FALLBACK
SMTP_USER = core.SMTP_USER
csv = core.csv
EmailMessage = core.EmailMessage
current_planning_month_key = core.current_planning_month_key
date = core.date
datetime = core.datetime
effective_planning_month_for_row = core.effective_planning_month_for_row
escape = core.escape
func = core.func
iter_planning_month_keys = core.iter_planning_month_keys
joinedload = core.joinedload
logger = core.logger
normalize_planning_month = core.normalize_planning_month
os = core.os
parse_iso_datetime = core.parse_iso_datetime
parse_planning_date_value = core.parse_planning_date_value
planning_month_from_date = core.planning_month_from_date
planning_month_is_past = core.planning_month_is_past
planning_month_label = core.planning_month_label
re = core.re
shutil = getattr(core, 'shutil', None)
shift_planning_month = core.shift_planning_month
smtplib = core.smtplib
ssl = core.ssl
timedelta = core.timedelta
utcnow = core.utcnow

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


def planning_warning_recipients_for_Reviewer() -> list[str]:
    # Temporary routing: Reviewer/admin warnings go to configured EMAIL_TO, else active owner/admin emails.
    return EMAIL_TO or default_admin_warning_recipients()


def planning_row_missing_Reviewer_fields(row: PlanningRow) -> list[str]:
    missing: list[str] = []
    for field_name, label in PLANNING_Reviewer_REQUIRED_FIELDS.items():
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
    elif warning_type == "Reviewer":
        if row.Reviewer_warning_key or row.Reviewer_warning_sent_at:
            row.Reviewer_warning_key = None
            row.Reviewer_warning_sent_at = None
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
            changed = clear_planning_warning_state(row, "Reviewer") or changed
            changed = clear_planning_warning_state(row, "ready") or changed
            continue
        if page is None or not notifications_enabled_for_page(page.id):
            changed = clear_planning_warning_state(row, "designer") or changed
            changed = clear_planning_warning_state(row, "Reviewer") or changed
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
                subject = f"[Sample SoMe-Auto] Critical warning | Job not green-ready | {page.name} | {job_ref}"
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
                    planning_warning_recipients_for_Reviewer(),
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
            changed = clear_planning_warning_state(row, "Reviewer") or changed
            continue

        missing_fields = planning_row_missing_Reviewer_fields(row)
        if missing_fields:
            if row.Reviewer_warning_key != deadline_warning_key:
                subject = f"[Sample SoMe-Auto] Planning row incomplete before deadline | {page.name} | {job_ref}"
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
                    planning_warning_recipients_for_Reviewer(),
                    html_body=html_body,
                ):
                    row.Reviewer_warning_key = deadline_warning_key
                    row.Reviewer_warning_sent_at = now
                    changed = True
        else:
            changed = clear_planning_warning_state(row, "Reviewer") or changed

        if not creative_items:
            designer_name = (row.designer or "").strip()
            if not designer_name:
                changed = clear_planning_warning_state(row, "designer") or changed
                continue
            if row.designer_warning_key == deadline_warning_key:
                continue

            subject = f"[Sample SoMe-Auto] Creative missing before deadline for {designer_name} | {page.name} | {job_ref}"
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

