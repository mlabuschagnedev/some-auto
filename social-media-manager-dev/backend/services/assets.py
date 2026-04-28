from __future__ import annotations

from ..media import is_valid_signed_media_request
from ..routes.common import (
    Any,
    BASE_DIR,
    Path,
    UPLOAD_DIR,
    jsonify,
    request,
    send_from_directory,
)

FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"

def _serve_spa_index(directory: Path) -> Any:
    return send_from_directory(str(directory), "index.html")

def _serve_existing_asset(directory: Path, relative_path: str) -> Any:
    return send_from_directory(str(directory), relative_path)

def serve_public_upload(filename: str) -> Any:
    relative = str(Path(filename)).replace("\\", "/")
    if ".." in Path(relative).parts:
        return jsonify({"error": "Invalid file path."}), 400

    exp = request.args.get("exp")
    sig = request.args.get("sig")
    if not is_valid_signed_media_request(relative, exp, sig):
        return jsonify({"error": "Invalid or expired media link."}), 403

    full_path = UPLOAD_DIR / relative
    if not full_path.exists():
        return jsonify({"error": "File not found."}), 404

    return send_from_directory(str(UPLOAD_DIR), relative)

def serve_upload(filename: str) -> Any:
    return send_from_directory(str(UPLOAD_DIR), filename)

def serve_frontend_index() -> Any:
    if (FRONTEND_DIST_DIR / "index.html").is_file():
        return _serve_spa_index(FRONTEND_DIST_DIR)
    return jsonify({"error": "Frontend build not found. Run the frontend build first."}), 503

def serve_frontend_assets(path: str) -> Any:
    if path == "legacy" or path.startswith("legacy/"):
        return jsonify({"error": "Legacy frontend removed from dev."}), 404
    if (FRONTEND_DIST_DIR / "index.html").is_file():
        frontend_path = FRONTEND_DIST_DIR / path
        if frontend_path.is_file():
            return _serve_existing_asset(FRONTEND_DIST_DIR, path)
        return _serve_spa_index(FRONTEND_DIST_DIR)
    return jsonify({"error": "Frontend build not found. Run the frontend build first."}), 503
