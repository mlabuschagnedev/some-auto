from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import diagnostics as service

bp = Blueprint("diagnostics", __name__)

@bp.route("/api/health", methods=["GET"])
def health() -> Any:
    return service.health()

@bp.route("/api/scheduler/status", methods=["GET"])
@jwt_required()
def scheduler_status() -> Any:
    return service.scheduler_status()

@bp.route("/api/tokens/status", methods=["GET"])
@jwt_required()
@require_roles("developer")
def token_status() -> Any:
    return service.token_status()

@bp.route("/api/integrations/check", methods=["GET"])
@jwt_required()
@require_roles("developer")
def integration_check() -> Any:
    return service.integration_check()

@bp.route("/api/pages/<int:page_id>/integrations/check", methods=["GET"])
@jwt_required()
@require_roles("developer")
def integration_check_for_page(page_id: int) -> Any:
    return service.integration_check_for_page(page_id)
