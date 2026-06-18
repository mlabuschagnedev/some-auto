from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import planning as service

bp = Blueprint("planning", __name__)

@bp.route("/api/planning/sheets", methods=["GET"])
@jwt_required()
def get_planning_sheets() -> Any:
    return service.get_planning_sheets()

@bp.route("/api/pages/<int:page_id>/planning", methods=["GET"])
@jwt_required()
def get_planning_for_page(page_id: int) -> Any:
    return service.get_planning_for_page(page_id)

@bp.route("/api/pages/<int:page_id>/planning/rows", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def create_planning_row(page_id: int) -> Any:
    return service.create_planning_row(page_id)

@bp.route("/api/planning/rows/<int:row_id>", methods=["PUT"])
@jwt_required()
def update_planning_row(row_id: int) -> Any:
    return service.update_planning_row(row_id)

@bp.route("/api/planning/rows/bulk-update", methods=["POST"])
@jwt_required()
def bulk_update_planning_rows() -> Any:
    return service.bulk_update_planning_rows()

@bp.route("/api/planning/rows/<int:row_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer", "admin")
def delete_planning_row(row_id: int) -> Any:
    return service.delete_planning_row(row_id)

@bp.route("/api/planning/rows/<int:row_id>/creative", methods=["POST"])
@jwt_required()
def upload_planning_creative(row_id: int) -> Any:
    return service.upload_planning_creative(row_id)

@bp.route("/api/planning/rows/<int:row_id>/schedule", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def schedule_from_planning_row(row_id: int) -> Any:
    return service.schedule_from_planning_row(row_id)

@bp.route("/api/planning/rows/<int:row_id>/publish", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def publish_from_planning_row(row_id: int) -> Any:
    return service.publish_from_planning_row(row_id)

@bp.route("/api/planning/import-csvs", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def import_planning_csvs() -> Any:
    return service.import_planning_csvs()
