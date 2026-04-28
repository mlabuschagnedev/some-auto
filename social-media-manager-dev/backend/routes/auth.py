from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import auth as service

bp = Blueprint("auth", __name__)

@bp.route("/api/auth/login", methods=["POST"])
def login() -> Any:
    return service.login()

@bp.route("/api/auth/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh() -> Any:
    return service.refresh()

@bp.route("/api/auth/verify", methods=["GET"])
@jwt_required()
def verify_token() -> Any:
    return service.verify_token()

@bp.route("/api/auth/logout", methods=["POST"])
@jwt_required()
def logout() -> Any:
    return service.logout()

@bp.route("/api/users", methods=["GET"])
@jwt_required()
@require_roles("developer")
def get_users() -> Any:
    return service.get_users()

@bp.route("/api/users", methods=["POST"])
@jwt_required()
@require_roles("developer")
def create_user() -> Any:
    return service.create_user()

@bp.route("/api/users/<username>", methods=["PUT"])
@jwt_required()
@require_roles("developer")
def update_user(username: str) -> Any:
    return service.update_user(username)

@bp.route("/api/users/<username>", methods=["DELETE"])
@jwt_required()
@require_roles("developer")
def delete_user(username: str) -> Any:
    return service.delete_user(username)
