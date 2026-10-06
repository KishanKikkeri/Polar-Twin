"""Health check schema."""

from typing import Literal

from pydantic import AwareDatetime

from app.schemas.common import ApiModel


class DatabaseHealth(ApiModel):
    status: Literal["ok", "unavailable"]
    detail: str | None = None


class HealthResponse(ApiModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    environment: str
    time: AwareDatetime
    database: DatabaseHealth
