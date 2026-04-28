from __future__ import annotations

from ..auth import require_roles
from ..models import Page, PlanningRow, PlanningSheet, db
from ..planning import (
    apply_planning_row_updates,
    build_linked_accounts_text,
    build_planning_month_options,
    current_planning_month_key,
    ensure_planning_sheet_for_page,
    import_planning_csvs_from_inbox,
    next_planning_row_order,
    normalize_planning_month,
    planning_designer_options,
    planning_month_is_past,
    planning_month_label,
    planning_row_sort_key,
)
from ..publishing import schedule_post_from_planning_row_record
from ..media import cleanup_unreferenced_uploads, store_upload, validate_page_creative_media
from ..routes.common import (
    Any,
    Blueprint,
    PLANNING_FAILED_COLOR,
    PLANNING_POSTED_COLOR,
    PLANNING_READY_COLOR,
    PLANNING_SCHEDULED_COLOR,
    func,
    get_json_body,
    joinedload,
    json_loads_safe,
    jsonify,
    jwt_required,
    request,
)

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

def get_planning_for_page(page_id: int) -> Any:
    page = Page.query.get_or_404(page_id)
    sheet = ensure_planning_sheet_for_page(page.id)
    selected_month = normalize_planning_month(request.args.get("month")) or current_planning_month_key()
    rows = PlanningRow.query.filter_by(sheet_id=sheet.id, planning_month=selected_month).all()
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

def delete_planning_row(row_id: int) -> Any:
    row = PlanningRow.query.get_or_404(row_id)
    previous_media = set(row.creative_media_list())
    db.session.delete(row)
    db.session.commit()
    cleanup_unreferenced_uploads(previous_media)
    return jsonify({"message": "Planning row deleted."})

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

def import_planning_csvs() -> Any:
    return jsonify(import_planning_csvs_from_inbox())
