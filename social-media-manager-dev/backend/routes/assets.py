from __future__ import annotations

from ..routes.common import Any, Blueprint
from ..services import assets as service

bp = Blueprint("assets", __name__)

@bp.route("/public/uploads/<path:filename>", methods=["GET"])
def serve_public_upload(filename: str) -> Any:
    return service.serve_public_upload(filename)

@bp.route("/uploads/<path:filename>")
def serve_upload(filename: str) -> Any:
    return service.serve_upload(filename)

@bp.route("/")
def serve_frontend_index() -> Any:
    return service.serve_frontend_index()

@bp.route("/<path:path>")
def serve_frontend_assets(path: str) -> Any:
    return service.serve_frontend_assets(path)
