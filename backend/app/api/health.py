"""Unversioned operational endpoints: /health and /metrics."""

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import timescale
from app.db.session import get_db
from app.observability.metrics import REGISTRY
from app.schemas.health import DatabaseHealth, HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service and database health",
    responses={503: {"model": HealthResponse, "description": "Database unreachable"}},
)
def health(db: Session = Depends(get_db)) -> JSONResponse:
    settings = get_settings()
    timescale_detail = None
    try:
        db.execute(text("SELECT 1"))
        ts_stat = timescale.detect(db.connection())
        timescale_detail = {
            "available": ts_stat.available,
            "version": ts_stat.installed_version,
            "hypertable": ts_stat.hypertable,
        }
        db_health = DatabaseHealth(status="ok")
    except Exception as exc:  # noqa: BLE001 - report any connectivity failure
        db_health = DatabaseHealth(status="unavailable", detail=type(exc).__name__)

    body = HealthResponse(
        status="ok" if db_health.status == "ok" else "degraded",
        service=settings.app_name,
        version=__version__,
        environment=settings.environment,
        time=utcnow(),
        database=db_health,
    )
    content = body.model_dump(mode="json")
    if timescale_detail:
        content["timescaledb"] = timescale_detail
    return JSONResponse(
        status_code=200 if body.status == "ok" else 503,
        content=content,
    )


@router.get("/metrics", summary="Prometheus metrics exposition", response_class=Response)
def metrics() -> Response:
    return Response(
        content=REGISTRY.render_prometheus(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
