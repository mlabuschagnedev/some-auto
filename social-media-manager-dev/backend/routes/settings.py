from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import settings as service

bp = Blueprint("settings", __name__)

@bp.route("/api/settings", methods=["GET"])
@jwt_required()
@require_roles("developer")
def get_settings() -> Any:
    return service.get_settings()

@bp.route("/api/settings", methods=["PUT"])
@jwt_required()
@require_roles("developer")
def update_settings() -> Any:
    return service.update_settings()

@bp.route("/api/pages/<int:page_id>/settings", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
def get_page_settings(page_id: int) -> Any:
    return service.get_page_settings(page_id)

@bp.route("/api/pages/<int:page_id>/settings", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
def update_page_settings(page_id: int) -> Any:
    return service.update_page_settings(page_id)

@bp.route("/api/pages/<int:page_id>/reference-sheets/<sheet_key>", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
def get_page_reference_sheet(page_id: int, sheet_key: str) -> Any:
    return service.get_page_reference_sheet(page_id, sheet_key)

@bp.route("/api/pages/<int:page_id>/reference-sheets/<sheet_key>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
def update_page_reference_sheet(page_id: int, sheet_key: str) -> Any:
    return service.update_page_reference_sheet(page_id, sheet_key)

@bp.route("/api/reference-sheets/<sheet_key>", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
def get_global_reference_sheet(sheet_key: str) -> Any:
    return service.get_global_reference_sheet(sheet_key)

@bp.route("/api/reference-sheets/<sheet_key>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
def update_global_reference_sheet(sheet_key: str) -> Any:
    return service.update_global_reference_sheet(sheet_key)
