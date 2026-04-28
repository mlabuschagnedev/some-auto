from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import pages as service

bp = Blueprint("pages", __name__)

@bp.route("/api/pages", methods=["GET"])
@jwt_required()
def get_pages() -> Any:
    return service.get_pages()

@bp.route("/api/pages", methods=["POST"])
@jwt_required()
@require_roles("developer")
def create_page() -> Any:
    return service.create_page()

@bp.route("/api/pages/<int:page_id>", methods=["GET"])
@jwt_required()
def get_page(page_id: int) -> Any:
    return service.get_page(page_id)

@bp.route("/api/pages/<int:page_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
def update_page(page_id: int) -> Any:
    return service.update_page(page_id)

@bp.route("/api/pages/<int:page_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_page(page_id: int) -> Any:
    return service.delete_page(page_id)

@bp.route("/api/pages/<int:page_id>/accounts", methods=["POST"])
@jwt_required()
@require_roles("developer")
def add_social_account(page_id: int) -> Any:
    return service.add_social_account(page_id)

@bp.route("/api/accounts/<int:account_id>/test", methods=["POST"])
@jwt_required()
@require_roles("developer")
def test_social_account(account_id: int) -> Any:
    return service.test_social_account(account_id)

@bp.route("/api/accounts/<int:account_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_social_account(account_id: int) -> Any:
    return service.delete_social_account(account_id)

@bp.route("/api/accounts/<int:account_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer")
def update_social_account(account_id: int) -> Any:
    return service.update_social_account(account_id)

@bp.route("/api/accounts/<int:account_id>/refresh", methods=["POST"])
@jwt_required()
@require_roles("developer")
def manual_refresh_token(account_id: int) -> Any:
    return service.manual_refresh_token(account_id)
