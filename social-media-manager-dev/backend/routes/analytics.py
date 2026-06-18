from __future__ import annotations

from ..auth import require_roles
from ..routes.common import Any, Blueprint, jwt_required
from ..services import analytics as service

bp = Blueprint("analytics", __name__)


@bp.route("/api/analytics/accounts", methods=["GET"])
@jwt_required()
def get_analytics_accounts() -> Any:
    return service.get_analytics_accounts()


@bp.route("/api/analytics/summary", methods=["GET"])
@jwt_required()
def get_analytics_summary() -> Any:
    return service.get_analytics_summary()


@bp.route("/api/analytics/trends", methods=["GET"])
@jwt_required()
def get_analytics_trends() -> Any:
    return service.get_analytics_trends()


@bp.route("/api/analytics/accounts/<int:account_id>", methods=["GET"])
@jwt_required()
def get_analytics_account(account_id: int) -> Any:
    return service.get_analytics_account(account_id)


@bp.route("/api/analytics/accounts/<int:account_id>/trends", methods=["GET"])
@jwt_required()
def get_analytics_account_trends(account_id: int) -> Any:
    return service.get_analytics_trends(account_id)


@bp.route("/api/analytics/accounts/<int:account_id>/insights", methods=["GET"])
@jwt_required()
def get_account_insights(account_id: int) -> Any:
    return service.get_account_insights(account_id)


@bp.route("/api/analytics/posts", methods=["GET"])
@jwt_required()
def get_analytics_posts() -> Any:
    return service.get_analytics_posts()


@bp.route("/api/analytics/posts/<int:post_id>", methods=["GET"])
@jwt_required()
def get_analytics_post(post_id: int) -> Any:
    return service.get_analytics_post(post_id)


@bp.route("/api/analytics/raw", methods=["GET"])
@jwt_required()
def get_analytics_raw() -> Any:
    return service.get_analytics_raw()


@bp.route("/api/analytics/export-report.xlsx", methods=["GET"])
@jwt_required()
def export_marketing_report_workbook() -> Any:
    return service.export_marketing_report_workbook()


@bp.route("/api/analytics/export-report", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def sync_marketing_report_google_sheet() -> Any:
    return service.sync_marketing_report_google_sheet()


@bp.route("/api/analytics/refresh", methods=["POST"])
@jwt_required()
@require_roles("developer", "admin")
def refresh_analytics() -> Any:
    return service.refresh_analytics()


@bp.route("/api/analytics/refresh/status", methods=["GET"])
@jwt_required()
@require_roles("developer", "admin")
def get_analytics_refresh_status() -> Any:
    return service.get_analytics_refresh_status()
