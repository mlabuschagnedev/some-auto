from __future__ import annotations

from ..auth import require_owner, require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import posts as service

bp = Blueprint("posts", __name__)

@bp.route("/api/pages/<int:page_id>/posts", methods=["GET"])
@jwt_required()
def get_page_posts(page_id: int) -> Any:
    return service.get_page_posts(page_id)

@bp.route("/api/posts", methods=["GET"])
@jwt_required()
def get_all_posts() -> Any:
    return service.get_all_posts()

@bp.route("/api/posts/<int:post_id>/linkedin/manual", methods=["POST"])
@jwt_required()
@require_owner
def update_linkedin_manual_post(post_id: int) -> Any:
    return service.update_linkedin_manual_post(post_id)

@bp.route("/api/pages/<int:page_id>/posts", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def create_post(page_id: int) -> Any:
    return service.create_post(page_id)

@bp.route("/api/posts/<int:post_id>", methods=["PUT"])
@jwt_required()
@require_roles("developer", "admin")
def update_post(post_id: int) -> Any:
    return service.update_post(post_id)

@bp.route("/api/posts/<int:post_id>", methods=["DELETE"])
@jwt_required()
@require_roles("developer", "admin")
def delete_post(post_id: int) -> Any:
    return service.delete_post(post_id)

@bp.route("/api/posts/<int:post_id>/publish", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def publish_now(post_id: int) -> Any:
    return service.publish_now(post_id)
