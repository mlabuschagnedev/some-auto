from __future__ import annotations

from ..models import (
    AccountInsightSnapshot,
    Page,
    PlatformPostReference,
    Post,
    PostInsightSnapshot,
    SocialAccount,
    SocialInsight,
    db,
)
from ..routes.common import Any, jsonify, request, utcnow
from .. import app as core

API_TIMEOUT_SECONDS = core.API_TIMEOUT_SECONDS
SOCIAL_INSIGHTS_META_API_VERSION = core.SOCIAL_INSIGHTS_META_API_VERSION
SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS = core.SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS
SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS = core.SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS
SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS = core.SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS
datetime = core.datetime
timedelta = core.timedelta
json = core.json
logger = core.logger
requests = core.requests
time = core.time
uuid = core.uuid
func = core.func
or_ = core.or_

REMOVED_INSIGHT_METRICS = {
    "fan_count",
    "fans",
    "page_fans",
    "page_fans_city",
    "page_fans_country",
    "page_fans_locale",
    "page_fan_adds",
    "page_fan_adds_unique",
    "page_fan_adds_by_paid_non_paid_unique",
    "page_fan_removes",
    "page_fan_removes_unique",
}

FACEBOOK_DAILY_METRIC_GROUPS = {
    "views": [
        {"metric": "page_media_view", "params": {"period": "day"}},
        {"metric": "page_views_total", "params": {"period": "day"}},
    ],
    "followers": [
        {"metric": "page_follows", "params": {"period": "day"}},
    ],
    "engagement": [
        {"metric": "page_post_engagements", "params": {"period": "day"}},
    ],
    "reactions": [
        {"metric": "page_actions_post_reactions_total", "params": {"period": "day"}},
    ],
}

INSTAGRAM_DAILY_METRIC_GROUPS = {
    "views": [{"metric": "views", "params": {"period": "day", "metric_type": "total_value"}}],
    "reach": [{"metric": "reach", "params": {"period": "day", "metric_type": "total_value"}}],
    "visits": [{"metric": "profile_views", "params": {"period": "day", "metric_type": "total_value"}}],
    "followers": [{"metric": "follower_count", "params": {"period": "day"}}],
    "online_followers": [{"metric": "online_followers", "params": {"period": "lifetime"}}],
    "engagement": [
        {"metric": "total_interactions", "params": {"period": "day", "metric_type": "total_value"}},
        {"metric": "accounts_engaged", "params": {"period": "day", "metric_type": "total_value"}},
    ],
}

ACCOUNT_OBJECT_FIELDS = {
    "facebook": ["name", "fan_count", "followers_count"],
    "instagram": ["name", "username", "followers_count", "media_count"],
}

ACCOUNT_OBJECT_FIELD_METRICS = {
    "facebook": {
        "followers_count": "followers",
        "fan_count": "followers",
    },
    "instagram": {
        "followers_count": "followers",
        "media_count": "media_count",
    },
}

OPTIONAL_DAILY_METRICS = {
    "facebook": {"views", "followers", "engagement", "reactions"},
    "instagram": {"followers", "online_followers", "engagement", "visits", "reach", "views"},
}

ZERO_WHEN_EMPTY_DAILY_METRICS = {
    "facebook": set(),
}

POST_INSIGHT_METRICS = {
    "instagram": [
        "reach",
        "views",
        "likes",
        "comments",
        "shares",
        "saved",
        "total_interactions",
    ],
}

InsightMetricCandidate = dict[str, Any]
InsightRunContext = dict[str, Any]


def _safe_error(error: Exception | str) -> str:
    text = str(error)
    if "access_token" in text:
        return "Meta API request failed. Check account permissions or token health."
    try:
        payload = json.loads(text)
    except Exception:
        payload = None
    if isinstance(payload, dict):
        message = str(payload.get("message") or "")
        code = payload.get("code")
        if code == 10 or "does not have permission" in message.lower():
            return "Meta permission unavailable for this insight metric. Check app permissions and account access."
        if message:
            return message[:500]
    return text[:500]


def _date_range(days: int = 30) -> tuple[datetime, datetime]:
    end = utcnow()
    start = end - timedelta(days=max(days, 1))
    return start, end


def _metric_names_for_platform(platform: str) -> list[str]:
    if platform == "facebook":
        return list(FACEBOOK_DAILY_METRIC_GROUPS.keys())
    if platform == "instagram":
        return list(INSTAGRAM_DAILY_METRIC_GROUPS.keys())
    return []


def _daily_metric_groups_for_platform(platform: str) -> dict[str, list[InsightMetricCandidate]]:
    if platform == "facebook":
        return FACEBOOK_DAILY_METRIC_GROUPS
    if platform == "instagram":
        return INSTAGRAM_DAILY_METRIC_GROUPS
    return {}


def _field_metric_groups_for_platform(platform: str) -> dict[str, list[str]]:
    return {}


def _friendly_metric_label(metric_name: str | None) -> str:
    labels = {
        "views": "Views",
        "engagement": "Engagement",
        "followers": "Followers",
        "reach": "Reach",
        "visits": "Visits",
        "media_count": "Media count",
        "profile_views": "Visits",
        "online_followers": "Online followers",
        "reactions": "Reactions",
        "likes": "Likes",
        "comments": "Comments",
        "shares": "Shares",
        "saved": "Saves",
        "total_interactions": "Total interactions",
    }
    normalized = str(metric_name or "").strip().lower()
    if normalized in labels:
        return labels[normalized]
    return " ".join(part.capitalize() for part in normalized.split("_") if part) or "Metric"


def _snapshot_date(start_date: datetime | None, end_date: datetime | None) -> datetime | None:
    return end_date or start_date


def _metadata_source(metadata: dict[str, Any] | None) -> str | None:
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("source")
    return str(value)[:80] if value else None


def _metadata_raw_metric(metric_name: str, metadata: dict[str, Any] | None) -> str:
    if not isinstance(metadata, dict):
        return metric_name
    for key in ("graph_metric", "raw_metric_name", "field"):
        value = metadata.get(key)
        if value:
            return str(value)[:160]
    candidate_metrics = metadata.get("candidate_metrics")
    if isinstance(candidate_metrics, list) and candidate_metrics:
        return str(candidate_metrics[0])[:160]
    candidate_fields = metadata.get("candidate_fields")
    if isinstance(candidate_fields, list) and candidate_fields:
        return str(candidate_fields[0])[:160]
    return metric_name


def _is_optional_daily_metric(platform: str, metric_name: str) -> bool:
    return metric_name in OPTIONAL_DAILY_METRICS.get(platform, set())


def _is_zero_when_empty_daily_metric(platform: str, metric_name: str) -> bool:
    return metric_name in ZERO_WHEN_EMPTY_DAILY_METRICS.get(platform, set())


def _is_permission_error(message: str) -> bool:
    text = message.lower()
    return "permission" in text or '"code": 10' in text or '"code":10' in text


def _is_metric_unavailable_error(message: str) -> bool:
    text = message.lower()
    return (
        "valid insights metric" in text
        or "must be a valid" in text
        or '"code": 100' in text
        or '"code":100' in text
        or "(#100)" in text
    )


def _graph_get(path: str, access_token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    query = dict(params or {})
    query["access_token"] = access_token
    response = requests.get(
        f"https://graph.facebook.com/{SOCIAL_INSIGHTS_META_API_VERSION}/{path.lstrip('/')}",
        params=query,
        timeout=API_TIMEOUT_SECONDS,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": response.text[:500]}
    if not response.ok:
        error = payload.get("error") if isinstance(payload, dict) else payload
        raise RuntimeError(json.dumps(error))
    return payload if isinstance(payload, dict) else {}


def _metric_number(value: Any) -> float | None:
    if isinstance(value, dict):
        numbers = [_metric_number(item) for item in value.values()]
        cleaned = [item for item in numbers if item is not None]
        return sum(cleaned) if cleaned else None
    if isinstance(value, list):
        numbers = [_metric_number(item) for item in value]
        cleaned = [item for item in numbers if item is not None]
        return sum(cleaned) if cleaned else None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _metadata_with_graph_metric(source: str, graph_metric: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    metadata = {"source": source, "graph_metric": graph_metric}
    if extra:
        metadata.update(extra)
    return metadata


def _is_removed_metric_name(metric_name: str | None) -> bool:
    normalized = str(metric_name or "").strip().lower()
    return normalized in REMOVED_INSIGHT_METRICS or normalized.startswith("page_fan")


def _visible_insight_filter() -> Any:
    return (
        SocialInsight.metric_value.isnot(None),
        SocialInsight.error_message.is_(None),
        ~func.lower(SocialInsight.metric_name).in_(REMOVED_INSIGHT_METRICS),
        ~func.lower(SocialInsight.metric_name).like("page_fan%"),
    )


def _new_run_context() -> InsightRunContext:
    started_at = utcnow()
    return {"id": uuid.uuid4().hex, "started_at": started_at}


def _run_id(run: InsightRunContext | None) -> str | None:
    return str(run["id"]) if run and run.get("id") else None


def _run_started_at(run: InsightRunContext | None) -> datetime | None:
    return run.get("started_at") if run else None


def _latest_run_id_for_account(account_id: int) -> str | None:
    row = (
        db.session.query(SocialInsight.refresh_run_id)
        .filter(SocialInsight.social_account_id == account_id)
        .filter(SocialInsight.refresh_run_id.isnot(None))
        .filter(*_visible_insight_filter())
        .order_by(SocialInsight.refresh_run_started_at.desc(), SocialInsight.refreshed_at.desc())
        .first()
    )
    if not row:
        return None
    return row[0]


def _latest_legacy_refreshed_at_for_account(account_id: int) -> datetime | None:
    return (
        db.session.query(func.max(SocialInsight.refreshed_at))
        .filter(SocialInsight.social_account_id == account_id)
        .scalar()
    )


def _latest_visible_insights_for_account(account_id: int, *, limit: int | None = None) -> list[SocialInsight]:
    query = SocialInsight.query.filter(SocialInsight.social_account_id == account_id)
    latest_run_id = _latest_run_id_for_account(account_id)
    if latest_run_id:
        query = query.filter(SocialInsight.refresh_run_id == latest_run_id)
    else:
        latest_refreshed_at = _latest_legacy_refreshed_at_for_account(account_id)
        if not latest_refreshed_at:
            return []
        query = query.filter(SocialInsight.refreshed_at >= latest_refreshed_at - timedelta(minutes=15))

    query = query.filter(*_visible_insight_filter())
    query = query.order_by(SocialInsight.end_date.asc().nullsfirst(), SocialInsight.metric_name.asc())
    if limit:
        query = query.limit(limit)
    return query.all()


def _visible_insight_history_for_account(account_id: int, *, limit: int | None = None) -> list[SocialInsight]:
    query = SocialInsight.query.filter(SocialInsight.social_account_id == account_id)
    query = query.filter(*_visible_insight_filter())
    query = query.order_by(
        SocialInsight.end_date.asc().nullsfirst(),
        SocialInsight.start_date.asc().nullsfirst(),
        SocialInsight.refreshed_at.asc(),
        SocialInsight.metric_name.asc(),
    )
    if limit:
        query = query.limit(limit)
    return query.all()


def _cleanup_removed_insight_metrics() -> None:
    removed = (
        SocialInsight.query.filter(
            or_(
                func.lower(SocialInsight.metric_name).in_(REMOVED_INSIGHT_METRICS),
                func.lower(SocialInsight.metric_name).like("page_fan%"),
            )
        ).delete(synchronize_session=False)
    )
    if removed:
        db.session.commit()


def _ensure_meta_token(account: SocialAccount) -> None:
    if account.access_token:
        return
    try:
        from ..integrations import apply_global_meta_token_to_account
        from ..settings import global_meta_user_token
    except Exception:
        return

    if not global_meta_user_token():
        return
    apply_global_meta_token_to_account(account)


def _mirror_account_snapshot(
    account: SocialAccount,
    *,
    metric_name: str,
    metric_value: float | None,
    period: str,
    start_date: datetime | None,
    end_date: datetime | None,
    metadata: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> AccountInsightSnapshot:
    raw_metric_name = _metadata_raw_metric(metric_name, metadata)
    status = "error" if error_message else "unavailable" if metric_value is None else "ok"
    date_value = _snapshot_date(start_date, end_date)
    snapshot = AccountInsightSnapshot.query.filter_by(
        social_account_id=account.id,
        metric_name=metric_name,
        period=period,
        date=date_value,
        raw_metric_name=raw_metric_name,
    ).first()
    if not snapshot:
        snapshot = AccountInsightSnapshot(
            social_account_id=account.id,
            metric_name=metric_name,
            period=period,
            date=date_value,
            raw_metric_name=raw_metric_name,
        )
        db.session.add(snapshot)

    changed = (
        snapshot.platform != account.platform
        or snapshot.metric_value != metric_value
        or snapshot.source != _metadata_source(metadata)
        or snapshot.status != status
        or snapshot.error_message != error_message
    )
    snapshot.platform = account.platform
    snapshot.metric_value = metric_value
    snapshot.source = _metadata_source(metadata)
    snapshot.status = status
    snapshot.error_message = error_message
    if changed or not snapshot.fetched_at:
        snapshot.fetched_at = utcnow()
    return snapshot


def _upsert_insight(
    account: SocialAccount,
    *,
    metric_name: str,
    metric_value: float | None,
    period: str,
    start_date: datetime | None,
    end_date: datetime | None,
    metadata: dict[str, Any] | None = None,
    error_message: str | None = None,
    run: InsightRunContext | None = None,
) -> SocialInsight:
    if _is_removed_metric_name(metric_name):
        raise RuntimeError("This insight metric is no longer supported.")

    insight = SocialInsight.query.filter_by(
        social_account_id=account.id,
        metric_name=metric_name,
        period=period,
        start_date=start_date,
        end_date=end_date,
    ).first()
    if not insight:
        insight = SocialInsight(
            social_account_id=account.id,
            platform=account.platform,
            metric_name=metric_name,
            period=period,
            start_date=start_date,
            end_date=end_date,
        )
        db.session.add(insight)

    insight.platform = account.platform
    insight.metric_value = metric_value
    insight.source_metadata = json.dumps(metadata or {})
    insight.refreshed_at = utcnow()
    insight.refresh_run_id = _run_id(run)
    insight.refresh_run_started_at = _run_started_at(run)
    if error_message:
        insight.last_error_at = insight.refreshed_at
        insight.error_message = error_message
    else:
        insight.last_success_at = insight.refreshed_at
        insight.error_message = None
    _mirror_account_snapshot(
        account,
        metric_name=metric_name,
        metric_value=metric_value,
        period=period,
        start_date=start_date,
        end_date=end_date,
        metadata=metadata,
        error_message=error_message,
    )
    return insight


def _store_account_error(account: SocialAccount, message: str, run: InsightRunContext | None = None) -> None:
    now = utcnow()
    for metric_name in _metric_names_for_platform(account.platform) or ["account_insights"]:
        _upsert_insight(
            account,
            metric_name=metric_name,
            metric_value=None,
            period="error",
            start_date=None,
            end_date=None,
            metadata={"platform": account.platform},
            error_message=message,
            run=run,
        )
    account.test_status = "failed"
    account.test_error = message
    account.last_tested = now


def _store_metric_error(
    account: SocialAccount,
    *,
    metric_name: str,
    period: str,
    start_date: datetime | None,
    end_date: datetime | None,
    message: str,
    metadata: dict[str, Any] | None = None,
    run: InsightRunContext | None = None,
) -> SocialInsight:
    return _upsert_insight(
        account,
        metric_name=metric_name,
        metric_value=None,
        period=period,
        start_date=start_date,
        end_date=end_date,
        metadata=metadata,
        error_message=_safe_error(message),
        run=run,
    )


def _store_metric_unavailable(
    account: SocialAccount,
    *,
    metric_name: str,
    period: str,
    start_date: datetime | None,
    end_date: datetime | None,
    metadata: dict[str, Any] | None = None,
    run: InsightRunContext | None = None,
) -> SocialInsight:
    details = dict(metadata or {})
    details["availability"] = "unavailable"
    return _upsert_insight(
        account,
        metric_name=metric_name,
        metric_value=None,
        period=period,
        start_date=start_date,
        end_date=end_date,
        metadata=details,
        error_message=None,
        run=run,
    )


def _refresh_field_metric_group(
    account: SocialAccount,
    metric_name: str,
    fields: list[str],
    run: InsightRunContext | None = None,
) -> list[SocialInsight]:
    if not fields or not account.page_id_external or not account.access_token:
        return []

    errors: list[str] = []
    for field in fields:
        try:
            payload = _graph_get(
                account.page_id_external,
                account.access_token,
                {"fields": field},
            )
        except Exception as error:
            errors.append(f"{field}: {_safe_error(error)}")
            continue

        metric_value = _metric_number(payload.get(field))
        if metric_value is None:
            errors.append(f"{field}: no numeric value returned")
            continue

        return [
            _upsert_insight(
                account,
                metric_name=metric_name,
                metric_value=metric_value,
                period="lifetime",
                start_date=None,
                end_date=None,
                metadata=_metadata_with_graph_metric("fields", field),
                run=run,
            )
        ]

    if errors:
        return [
            _store_metric_error(
                account,
                metric_name=metric_name,
                period="lifetime",
                start_date=None,
                end_date=None,
                message="; ".join(errors),
                metadata={"source": "fields", "candidate_fields": fields},
                run=run,
            )
        ]
    return []


def _refresh_field_metrics(account: SocialAccount, run: InsightRunContext | None = None) -> list[SocialInsight]:
    if not account.page_id_external or not account.access_token:
        return []

    fields = ACCOUNT_OBJECT_FIELDS.get(account.platform, [])
    field_metrics = ACCOUNT_OBJECT_FIELD_METRICS.get(account.platform, {})
    if not fields or not field_metrics:
        return []

    payload: dict[str, Any] = {}
    try:
        payload = _graph_get(account.page_id_external, account.access_token, {"fields": ",".join(fields)})
    except Exception as combined_error:
        logger.info(
            "Combined object field lookup failed for account_id=%s platform=%s: %s",
            account.id,
            account.platform,
            _safe_error(combined_error),
        )
        for field in fields:
            try:
                payload.update(_graph_get(account.page_id_external, account.access_token, {"fields": field}))
            except Exception:
                continue

    display_name = payload.get("username") or payload.get("name")
    if display_name:
        account.account_name = str(display_name)[:100]

    stored: list[SocialInsight] = []
    seen_metrics: set[str] = set()
    missing_by_metric: dict[str, list[str]] = {}
    for field in fields:
        metric_name = field_metrics.get(field)
        if not metric_name or metric_name in seen_metrics:
            continue
        metric_value = _metric_number(payload.get(field))
        if metric_value is None:
            missing_by_metric.setdefault(metric_name, []).append(field)
            continue
        seen_metrics.add(metric_name)
        stored.append(
            _upsert_insight(
                account,
                metric_name=metric_name,
                metric_value=metric_value,
                period="lifetime",
                start_date=None,
                end_date=None,
                metadata=_metadata_with_graph_metric("fields", field),
                run=run,
            )
        )

    for metric_name, missing_fields in missing_by_metric.items():
        if metric_name in seen_metrics:
            continue
        stored.append(
            _store_metric_unavailable(
                account,
                metric_name=metric_name,
                period="lifetime",
                start_date=None,
                end_date=None,
                metadata={"source": "fields", "candidate_fields": missing_fields, "reason": "no_data"},
                run=run,
            )
        )
    return stored


def _refresh_daily_metric(
    account: SocialAccount,
    metric_name: str,
    candidate: InsightMetricCandidate,
    start: datetime,
    end: datetime,
    run: InsightRunContext | None = None,
) -> list[SocialInsight]:
    if not account.page_id_external or not account.access_token:
        raise RuntimeError("Account is missing Meta object ID or access token.")
    graph_metric = str(candidate.get("metric") or "").strip()
    if not graph_metric:
        return []
    params = dict(candidate.get("params") or {})
    params.update(
        {
            "metric": graph_metric,
            "since": start.strftime("%Y-%m-%d"),
            "until": end.strftime("%Y-%m-%d"),
        }
    )
    payload = _graph_get(
        f"{account.page_id_external}/insights",
        account.access_token,
        params,
    )
    data = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(data, list):
        return []
    stored: list[SocialInsight] = []
    for metric in data:
        values = metric.get("values") if isinstance(metric, dict) else []
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, dict):
                continue
            end_time = item.get("end_time")
            try:
                end_date = core.parse_iso_datetime(str(end_time)) if end_time else None
            except Exception:
                end_date = None
            value = item.get("value")
            metric_value = _metric_number(value)
            stored.append(
                _upsert_insight(
                    account,
                    metric_name=metric_name,
                    metric_value=metric_value,
                    period="day",
                    start_date=None,
                    end_date=end_date,
                    metadata=_metadata_with_graph_metric("insights", graph_metric),
                    run=run,
                )
            )
    return stored


def _refresh_daily_metric_group(
    account: SocialAccount,
    metric_name: str,
    graph_metrics: list[InsightMetricCandidate],
    start: datetime,
    end: datetime,
    run: InsightRunContext | None = None,
) -> list[SocialInsight]:
    errors: list[str] = []
    candidate_names = [str(candidate.get("metric") or "") for candidate in graph_metrics]
    for candidate in graph_metrics:
        graph_metric = str(candidate.get("metric") or "").strip()
        try:
            stored = _refresh_daily_metric(account, metric_name, candidate, start, end, run)
        except Exception as error:
            errors.append(f"{graph_metric}: {_safe_error(error)}")
            continue

        if stored:
            return stored
        errors.append(f"{graph_metric}: no values returned")

    if _is_zero_when_empty_daily_metric(account.platform, metric_name) and all(
        "no values returned" in error for error in errors
    ):
        return [
            _upsert_insight(
                account,
                metric_name=metric_name,
                metric_value=0,
                period="day",
                start_date=start,
                end_date=end,
                metadata={
                    "source": "insights",
                    "candidate_metrics": candidate_names,
                    "note": "Meta returned no rows; stored as zero activity for the selected range.",
                },
                run=run,
            )
        ]

    if _is_optional_daily_metric(account.platform, metric_name) and (
        not errors
        or any(_is_permission_error(error) for error in errors)
        or any(_is_metric_unavailable_error(error) for error in errors)
        or all("no values returned" in error for error in errors)
    ):
        return [
            _store_metric_unavailable(
                account,
                metric_name=metric_name,
                period="day",
                start_date=start,
                end_date=end,
                metadata={
                    "source": "insights",
                    "candidate_metrics": candidate_names,
                    "reason": "permission_unavailable" if errors else "no_data",
                },
                run=run,
            )
        ]

    return [
        _store_metric_error(
            account,
            metric_name=metric_name,
            period="day",
            start_date=start,
            end_date=end,
            message="; ".join(errors) if errors else "No data returned.",
            metadata={"source": "insights", "candidate_metrics": candidate_names},
            run=run,
        )
    ]


def _platform_post_id_for_post(post: Post, platform: str) -> str | None:
    value = {
        "facebook": post.facebook_post_id or post.facebook_remote_post_id,
        "instagram": post.instagram_post_id,
        "linkedin": post.linkedin_post_id,
        "twitter": post.twitter_post_id,
        "pinterest": post.pinterest_post_id,
    }.get(platform)
    return str(value).strip() if value else None


def _ensure_post_references_for_account(account: SocialAccount) -> list[PlatformPostReference]:
    if not account.id:
        return []
    posts = (
        Post.query.filter(Post.page_id == account.page_id)
        .filter(Post.status.in_(["posted", "manual_pending"]))
        .order_by(Post.posted_at.desc().nullslast(), Post.id.desc())
        .limit(250)
        .all()
    )
    references: list[PlatformPostReference] = []
    for post in posts:
        platform_post_id = _platform_post_id_for_post(post, account.platform)
        if not platform_post_id:
            continue
        reference = PlatformPostReference.query.filter_by(
            internal_post_id=post.id,
            social_account_id=account.id,
            platform_post_id=platform_post_id,
        ).first()
        if not reference:
            reference = PlatformPostReference(
                internal_post_id=post.id,
                social_account_id=account.id,
                platform=account.platform,
                platform_post_id=platform_post_id,
            )
            db.session.add(reference)
        reference.platform = account.platform
        reference.permalink = post.platform_url_map().get(account.platform)
        reference.published_at = post.posted_at or post.scheduled_time or post.created_at
        reference.media_type = post.media_type
        reference.caption_preview = (post.content or "")[:280]
        references.append(reference)
    return references


def _upsert_post_insight(
    reference: PlatformPostReference,
    *,
    metric_name: str,
    metric_value: float | None,
    period: str,
    date_value: datetime | None,
    status: str,
    error_message: str | None = None,
) -> PostInsightSnapshot:
    snapshot = PostInsightSnapshot.query.filter_by(
        internal_post_id=reference.internal_post_id,
        social_account_id=reference.social_account_id,
        platform_post_id=reference.platform_post_id,
        metric_name=metric_name,
        period=period,
        date=date_value,
    ).first()
    if not snapshot:
        snapshot = PostInsightSnapshot(
            internal_post_id=reference.internal_post_id,
            social_account_id=reference.social_account_id,
            platform_post_id=reference.platform_post_id,
            metric_name=metric_name,
            period=period,
            date=date_value,
        )
        db.session.add(snapshot)

    changed = (
        snapshot.platform != reference.platform
        or snapshot.metric_value != metric_value
        or snapshot.status != status
        or snapshot.error_message != error_message
    )
    snapshot.platform = reference.platform
    snapshot.metric_value = metric_value
    snapshot.status = status
    snapshot.error_message = error_message
    if changed or not snapshot.fetched_at:
        snapshot.fetched_at = utcnow()
    return snapshot


def _media_insight_value(payload: dict[str, Any]) -> float | None:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return None
    values: list[float] = []
    for metric in data:
        if not isinstance(metric, dict):
            continue
        total_value = metric.get("total_value")
        if total_value is not None:
            number = _metric_number(total_value.get("value") if isinstance(total_value, dict) else total_value)
            if number is not None:
                values.append(number)
                continue
        raw_values = metric.get("values")
        if isinstance(raw_values, list):
            for item in raw_values:
                if isinstance(item, dict):
                    number = _metric_number(item.get("value"))
                    if number is not None:
                        values.append(number)
    return sum(values) if values else None


def _refresh_post_insights_for_reference(reference: PlatformPostReference, account: SocialAccount) -> list[PostInsightSnapshot]:
    metrics = POST_INSIGHT_METRICS.get(reference.platform, [])
    if not metrics or not account.access_token or not reference.platform_post_id:
        return []

    stored: list[PostInsightSnapshot] = []
    date_value = reference.published_at
    for metric_name in metrics:
        try:
            payload = _graph_get(
                f"{reference.platform_post_id}/insights",
                account.access_token,
                {"metric": metric_name},
            )
            metric_value = _media_insight_value(payload)
            if metric_value is None:
                stored.append(
                    _upsert_post_insight(
                        reference,
                        metric_name=metric_name,
                        metric_value=None,
                        period="lifetime",
                        date_value=date_value,
                        status="unavailable",
                        error_message=None,
                    )
                )
                continue
            stored.append(
                _upsert_post_insight(
                    reference,
                    metric_name=metric_name,
                    metric_value=metric_value,
                    period="lifetime",
                    date_value=date_value,
                    status="ok",
                )
            )
        except Exception as error:
            stored.append(
                _upsert_post_insight(
                    reference,
                    metric_name=metric_name,
                    metric_value=None,
                    period="lifetime",
                    date_value=date_value,
                    status="error" if not _is_permission_error(str(error)) else "unavailable",
                    error_message=_safe_error(error),
                )
            )
    return stored


def _refresh_recent_post_insights(account: SocialAccount) -> list[PostInsightSnapshot]:
    references = _ensure_post_references_for_account(account)
    cutoff = utcnow() - timedelta(days=30)
    stored: list[PostInsightSnapshot] = []
    for reference in references:
        if reference.published_at and reference.published_at < cutoff:
            continue
        stored.extend(_refresh_post_insights_for_reference(reference, account))
    return stored


def refresh_account_insights(account: SocialAccount, *, force: bool = False) -> dict[str, Any]:
    if account.platform not in {"facebook", "instagram"}:
        return {"account_id": account.id, "status": "skipped", "reason": "unsupported platform"}
    if not account.is_active:
        return {"account_id": account.id, "status": "skipped", "reason": "inactive"}

    latest = (
        SocialInsight.query.filter_by(social_account_id=account.id)
        .order_by(SocialInsight.refreshed_at.desc())
        .first()
    )
    if latest and not force:
        age_seconds = (utcnow() - latest.refreshed_at).total_seconds()
        if age_seconds < SOCIAL_INSIGHTS_MIN_REFRESH_SECONDS:
            return {"account_id": account.id, "status": "skipped", "reason": "recently refreshed"}

    run = _new_run_context()
    start, end = _date_range(30)
    count = 0
    post_count = 0
    metric_errors = 0
    try:
        _cleanup_removed_insight_metrics()
        _ensure_meta_token(account)
        if not account.page_id_external or not account.access_token:
            message = "Account is missing Meta object ID or access token. Reconnect the account or refresh the global Meta token."
            _store_account_error(account, message, run)
            db.session.commit()
            return {"account_id": account.id, "status": "failed", "error": message}

        for insight in _refresh_field_metrics(account, run):
            if insight.error_message:
                metric_errors += 1
            elif insight.metric_value is not None:
                count += 1

        for metric_name, graph_metrics in _daily_metric_groups_for_platform(account.platform).items():
            try:
                for insight in _refresh_daily_metric_group(account, metric_name, graph_metrics, start, end, run):
                    if insight.error_message:
                        metric_errors += 1
                    elif insight.metric_value is not None:
                        count += 1
            except Exception as metric_error:
                metric_errors += 1
                _store_metric_error(
                    account,
                    metric_name=metric_name,
                    period="day",
                    start_date=start,
                    end_date=end,
                    metadata={
                        "source": "insights",
                        "candidate_metrics": [str(candidate.get("metric") or "") for candidate in graph_metrics],
                    },
                    message=_safe_error(metric_error),
                    run=run,
                )

        for snapshot in _refresh_recent_post_insights(account):
            if snapshot.status == "error":
                metric_errors += 1
            elif snapshot.metric_value is not None:
                post_count += 1

        if count or post_count:
            account.test_status = "success"
            account.test_error = None
        else:
            account.test_status = "failed"
            account.test_error = "No insights could be refreshed. Check Meta permissions, object ID, and account type."
        account.last_tested = utcnow()
        db.session.commit()
        total_count = count + post_count
        status = "refreshed" if total_count and metric_errors == 0 else "partial" if total_count else "failed"
        return {
            "account_id": account.id,
            "status": status,
            "insights": count,
            "post_insights": post_count,
            "metric_errors": metric_errors,
        }
    except Exception as error:
        db.session.rollback()
        _store_account_error(account, _safe_error(error), run)
        db.session.commit()
        return {"account_id": account.id, "status": "failed", "error": _safe_error(error)}


def refresh_all_social_insights(*, force: bool = False, paced: bool = False) -> dict[str, Any]:
    accounts = (
        SocialAccount.query.filter(SocialAccount.platform.in_(["facebook", "instagram"]))
        .order_by(SocialAccount.id.asc())
        .all()
    )
    results: list[dict[str, Any]] = []
    pace_seconds = max(float(SOCIAL_INSIGHTS_ACCOUNT_PACE_SECONDS or 0), 0.0) if paced else 0.0
    for index, account in enumerate(accounts):
        results.append(refresh_account_insights(account, force=force))
        if pace_seconds and index < len(accounts) - 1:
            logger.debug(
                "Pacing social insights refresh for %.1f second(s) before the next account.",
                pace_seconds,
            )
            time.sleep(pace_seconds)
    return {
        "accounts_seen": len(accounts),
        "refreshed": sum(1 for item in results if item.get("status") in {"refreshed", "partial"}),
        "failed": sum(1 for item in results if item.get("status") == "failed"),
        "paced": paced,
        "pace_seconds": pace_seconds,
        "results": results,
    }


def _account_payload(account: SocialAccount) -> dict[str, Any]:
    insights = _visible_insight_history_for_account(account.id, limit=5000)
    latest = (
        SocialInsight.query.filter_by(social_account_id=account.id)
        .order_by(SocialInsight.refreshed_at.desc())
        .first()
    )
    metrics = _metric_summary_from_insights(insights)
    state = "ready" if account.is_active and account.page_id_external and account.access_token else "needs_setup"
    if account.test_error:
        state = "warning"
    return {
        "id": account.id,
        "page_id": account.page_id,
        "page_name": account.page.name if account.page else None,
        "platform": account.platform,
        "account_name": account.account_name,
        "page_id_external": account.page_id_external,
        "is_active": account.is_active,
        "ready": bool(account.is_active and account.page_id_external and account.access_token),
        "last_refreshed_at": latest.refreshed_at.isoformat() if latest else None,
        "last_refresh_run_id": latest.refresh_run_id if latest else None,
        "last_refresh_run_started_at": latest.refresh_run_started_at.isoformat() if latest and latest.refresh_run_started_at else None,
        "last_error": account.test_error,
        "state": state,
        "followers": metrics.get("followers", 0),
        "views": metrics.get("views", 0),
        "engagement": metrics.get("engagement", 0),
        "reach": metrics.get("reach", 0),
        "media_count": metrics.get("media_count", 0),
        "insight_count": len(insights),
        "insights": [insight.to_dict() for insight in insights],
    }


def _metric_category(metric_name: str | None) -> str:
    normalized = str(metric_name or "").strip().lower()
    if normalized in {"page_media_view", "page_views_total", "views"}:
        return "views"
    if normalized in {"page_post_engagements", "engagement", "total_interactions", "accounts_engaged"}:
        return "engagement"
    if normalized in {"followers", "followers_count", "follower_count", "page_follows"}:
        return "followers"
    if normalized in {"reach"}:
        return "reach"
    if normalized in {"media_count"}:
        return "media_count"
    if normalized in {"visits", "profile_views"}:
        return "visits"
    if normalized in {"online_followers", "reactions"}:
        return normalized
    return normalized or "metric"


def _metric_summary_from_insights(insights: list[SocialInsight]) -> dict[str, int]:
    totals: dict[str, float] = {}
    latest_lifetime: dict[str, tuple[datetime, float]] = {}
    for insight in insights:
        if insight.metric_value is None or insight.error_message:
            continue
        category = _metric_category(insight.metric_name)
        value = float(insight.metric_value or 0)
        if insight.period == "lifetime":
            marker = insight.refreshed_at or insight.end_date or insight.start_date or utcnow()
            current = latest_lifetime.get(category)
            if not current or marker > current[0]:
                latest_lifetime[category] = (marker, value)
            continue
        totals[category] = totals.get(category, 0) + value
    for category, (_, value) in latest_lifetime.items():
        totals[category] = value
    return {key: int(round(value)) for key, value in totals.items()}


def _parse_range_args() -> tuple[datetime | None, datetime | None]:
    range_key = (request.args.get("range") or "30d").strip().lower()
    now = utcnow()
    start: datetime | None = None
    end: datetime | None = None
    if range_key == "7d":
        start = now - timedelta(days=7)
    elif range_key == "30d":
        start = now - timedelta(days=30)
    elif range_key == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif range_key == "custom":
        try:
            start = core.parse_iso_datetime(f"{request.args.get('start')}T00:00:00") if request.args.get("start") else None
        except Exception:
            start = None
        try:
            end = core.parse_iso_datetime(f"{request.args.get('end')}T23:59:59") if request.args.get("end") else None
        except Exception:
            end = None
    return start, end


def _date_in_range(value: datetime | None, start: datetime | None, end: datetime | None) -> bool:
    if not value:
        return start is None and end is None
    if start and value < start:
        return False
    if end and value > end:
        return False
    return True


def _filtered_accounts() -> list[SocialAccount]:
    platform = (request.args.get("platform") or "all").strip().lower()
    page_id = request.args.get("page_id", type=int)
    query = SocialAccount.query.filter(SocialAccount.platform.in_(["facebook", "instagram"]))
    if platform in {"facebook", "instagram"}:
        query = query.filter(SocialAccount.platform == platform)
    if page_id:
        query = query.filter(SocialAccount.page_id == page_id)
    return query.order_by(SocialAccount.platform.asc(), SocialAccount.account_name.asc()).all()


def _filtered_visible_insights(account: SocialAccount) -> list[SocialInsight]:
    start, end = _parse_range_args()
    metric = (request.args.get("metric") or "all").strip().lower()
    rows = _latest_visible_insights_for_account(account.id, limit=1000)
    filtered: list[SocialInsight] = []
    for insight in rows:
        if metric != "all" and _metric_category(insight.metric_name) != metric and insight.metric_name != metric:
            continue
        if not _date_in_range(_snapshot_date(insight.start_date, insight.end_date) or insight.refreshed_at, start, end):
            continue
        filtered.append(insight)
    return filtered


def _trend_rows(accounts: list[SocialAccount]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, float]] = {}
    for account in accounts:
        for insight in _filtered_visible_insights(account):
            if insight.metric_value is None:
                continue
            date_value = _snapshot_date(insight.start_date, insight.end_date) or insight.refreshed_at
            if not date_value:
                continue
            key = date_value.strftime("%Y-%m-%d")
            bucket = buckets.setdefault(
                key,
                {"date": key, "views": 0, "engagement": 0, "followers": 0, "reach": 0, "visits": 0, "media_count": 0},
            )
            category = _metric_category(insight.metric_name)
            if category in bucket:
                bucket[category] = float(bucket.get(category, 0)) + float(insight.metric_value or 0)
    return [
        {
            key: int(round(value)) if isinstance(value, float) else value
            for key, value in bucket.items()
        }
        for _, bucket in sorted(buckets.items())
    ]


def _scheduler_refresh_info() -> dict[str, Any]:
    job = core.scheduler.get_job("refresh_social_insights") if core.scheduler.running else None
    latest = db.session.query(func.max(SocialInsight.refreshed_at)).scalar()
    return {
        "status": "idle",
        "last_refreshed_at": latest.isoformat() if latest else None,
        "next_scheduled_refresh_at": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "refresh_interval_seconds": SOCIAL_INSIGHTS_REFRESH_INTERVAL_SECONDS,
    }


def _top_post_rows(limit: int = 10) -> list[dict[str, Any]]:
    accounts = _filtered_accounts()
    for account in accounts:
        _ensure_post_references_for_account(account)
    db.session.flush()

    account_ids = [account.id for account in accounts]
    if not account_ids:
        return []
    references = (
        PlatformPostReference.query.filter(PlatformPostReference.social_account_id.in_(account_ids))
        .order_by(PlatformPostReference.published_at.desc().nullslast(), PlatformPostReference.id.desc())
        .limit(100)
        .all()
    )
    rows: list[dict[str, Any]] = []
    for reference in references:
        metrics = {
            snapshot.metric_name: snapshot.metric_value
            for snapshot in PostInsightSnapshot.query.filter_by(
                internal_post_id=reference.internal_post_id,
                social_account_id=reference.social_account_id,
                platform_post_id=reference.platform_post_id,
            ).all()
            if snapshot.metric_value is not None and snapshot.status == "ok"
        }
        engagement = sum(float(metrics.get(name) or 0) for name in ["likes", "comments", "shares", "saved", "total_interactions"])
        post = reference.post
        account = reference.account
        rows.append(
            {
                "id": reference.id,
                "internal_post_id": reference.internal_post_id,
                "social_account_id": reference.social_account_id,
                "page_name": account.page.name if account and account.page else post.page.name if post and post.page else None,
                "account_name": account.account_name if account else None,
                "thumbnail": None,
                "caption": reference.caption_preview or (post.content[:280] if post and post.content else ""),
                "platform": reference.platform,
                "platform_post_id": reference.platform_post_id,
                "published_at": reference.published_at.isoformat() if reference.published_at else None,
                "views": int(metrics.get("views") or 0),
                "reach": int(metrics.get("reach") or 0),
                "engagement": int(round(engagement)),
                "comments": int(metrics.get("comments") or 0),
                "shares": int(metrics.get("shares") or 0),
                "permalink": reference.permalink,
                "state": "ready" if metrics else "No post insights yet",
                "metrics": metrics,
            }
        )
    rows.sort(key=lambda row: (row.get("engagement") or 0, row.get("views") or 0), reverse=True)
    return rows[:limit]


def get_analytics_summary() -> Any:
    accounts = _filtered_accounts()
    account_rows: list[dict[str, Any]] = []
    totals = {"views": 0, "engagement": 0, "followers": 0, "reach": 0, "visits": 0, "media_count": 0}
    for account in accounts:
        insights = _filtered_visible_insights(account)
        metrics = _metric_summary_from_insights(insights)
        for key in totals:
            totals[key] += metrics.get(key, 0)
        account_rows.append(
            {
                "id": account.id,
                "name": account.account_name or account.page.name if account.page else account.account_name or f"{account.platform} account",
                "platform": account.platform,
                "page_name": account.page.name if account.page else None,
                "followers": metrics.get("followers", 0),
                "views": metrics.get("views", 0),
                "engagement": metrics.get("engagement", 0),
                "reach": metrics.get("reach", 0),
                "visits": metrics.get("visits", 0),
                "last_refreshed": max((insight.refreshed_at for insight in insights), default=None).isoformat() if insights else None,
                "state": "warning" if account.test_error else "ready" if account.is_active and account.page_id_external and account.access_token else "needs_setup",
            }
        )

    best_account = max(account_rows, key=lambda row: row["views"] + row["engagement"], default=None)
    top_posts = _top_post_rows(limit=6)
    summary_cards = [
        {"label": "Total views", "value": totals["views"], "delta": None, "tone": "info"},
        {"label": "Total engagement", "value": totals["engagement"], "delta": None, "tone": "good"},
        {"label": "Total followers", "value": totals["followers"], "delta": None, "tone": "info"},
        {"label": "Follower growth", "value": 0, "delta": "tracking from next refresh", "tone": "neutral"},
        {"label": "Best account", "value": best_account["name"] if best_account else "No data", "delta": None, "tone": "good" if best_account else "neutral"},
        {"label": "Accounts needing attention", "value": sum(1 for row in account_rows if row["state"] != "ready"), "delta": None, "tone": "warn"},
    ]
    return jsonify(
        {
            "summary_cards": summary_cards,
            "totals": totals,
            "trends": _trend_rows(accounts),
            "account_comparison": account_rows,
            "top_posts": top_posts,
            "refresh": _scheduler_refresh_info(),
        }
    )


def get_analytics_trends(account_id: int | None = None) -> Any:
    accounts = [SocialAccount.query.get_or_404(account_id)] if account_id else _filtered_accounts()
    return jsonify({"items": _trend_rows(accounts)})


def get_analytics_posts() -> Any:
    return jsonify({"items": _top_post_rows(limit=request.args.get("limit", 25, type=int) or 25)})


def get_analytics_post(post_id: int) -> Any:
    post = Post.query.get_or_404(post_id)
    references = PlatformPostReference.query.filter_by(internal_post_id=post.id).all()
    return jsonify(
        {
            "id": post.id,
            "page_id": post.page_id,
            "page_name": post.page.name if post.page else None,
            "caption": post.content or "",
            "media_type": post.media_type,
            "published_at": post.posted_at.isoformat() if post.posted_at else None,
            "status": post.status,
            "references": [
                {
                    **reference.to_dict(),
                    "insights": [
                        snapshot.to_dict()
                        for snapshot in PostInsightSnapshot.query.filter_by(
                            internal_post_id=post.id,
                            social_account_id=reference.social_account_id,
                            platform_post_id=reference.platform_post_id,
                        )
                        .order_by(PostInsightSnapshot.metric_name.asc())
                        .all()
                    ],
                }
                for reference in references
            ],
        }
    )


def get_analytics_raw() -> Any:
    limit = min(max(request.args.get("limit", 250, type=int) or 250, 1), 1000)
    account_ids = [account.id for account in _filtered_accounts()]
    rows: list[dict[str, Any]] = []
    if account_ids:
        snapshots = (
            AccountInsightSnapshot.query.filter(AccountInsightSnapshot.social_account_id.in_(account_ids))
            .order_by(AccountInsightSnapshot.fetched_at.desc())
            .limit(limit)
            .all()
        )
        rows.extend(
            {
                **snapshot.to_dict(),
                "record_type": "account",
                "friendly_label": _friendly_metric_label(snapshot.metric_name),
            }
            for snapshot in snapshots
        )
        remaining = max(limit - len(rows), 0)
        if remaining:
            post_snapshots = (
                PostInsightSnapshot.query.filter(PostInsightSnapshot.social_account_id.in_(account_ids))
                .order_by(PostInsightSnapshot.fetched_at.desc())
                .limit(remaining)
                .all()
            )
            rows.extend(
                {
                    **snapshot.to_dict(),
                    "record_type": "post",
                    "friendly_label": _friendly_metric_label(snapshot.metric_name),
                }
                for snapshot in post_snapshots
            )
    return jsonify({"items": rows})


def get_analytics_accounts() -> Any:
    platform = (request.args.get("platform") or "all").strip().lower()
    query = SocialAccount.query.filter(SocialAccount.platform.in_(["facebook", "instagram"]))
    if platform in {"facebook", "instagram"}:
        query = query.filter(SocialAccount.platform == platform)
    accounts = query.order_by(SocialAccount.platform.asc(), SocialAccount.account_name.asc()).all()
    return jsonify({"items": [_account_payload(account) for account in accounts]})


def get_analytics_account(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    return jsonify(_account_payload(account))


def get_account_insights(account_id: int) -> Any:
    account = SocialAccount.query.get_or_404(account_id)
    insights = _latest_visible_insights_for_account(account.id)
    return jsonify({"items": [insight.to_dict() for insight in insights]})


def refresh_analytics() -> Any:
    account_id = request.args.get("account_id", type=int)
    force = str(request.args.get("force") or "").lower() in {"1", "true", "yes", "on"}
    if account_id:
        account = SocialAccount.query.get_or_404(account_id)
        return jsonify(refresh_account_insights(account, force=force))
    return jsonify(refresh_all_social_insights(force=force))
