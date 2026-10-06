"""Unversioned operational endpoints."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db.session import get_db
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
    try:
        db.execute(text("SELECT 1"))
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
    return JSONResponse(
        status_code=200 if body.status == "ok" else 503,
        content=body.model_dump(mode="json"),
    )
