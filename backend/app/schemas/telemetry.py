"""Raw telemetry schemas."""

from typing import Literal

from pydantic import AwareDatetime, Field

from app.domain.enums import Provenance, Quality
from app.schemas.common import ApiModel


class TelemetryReadingSchema(ApiModel):
    """A single raw reading exactly as stored. ``value`` is null iff quality is MISSING."""

    id: int
    channel_id: str
    asset_id: str
    metric: str
    observed_at: AwareDatetime = Field(description="When the value applies (UTC, ISO 8601)")
    ingested_at: AwareDatetime = Field(description="When the platform received the value (UTC)")
    value: float | None = Field(description="Null only when quality is MISSING — never coerced to 0")
    unit: str
    provenance: Provenance
    quality: Quality
    source: str


class TelemetryFilters(ApiModel):
    asset_id: str | None = None
    metric: str | None = None
    provenance: list[Provenance] | None = None
    quality: list[Quality] | None = None
    start: AwareDatetime | None = None
    end: AwareDatetime | None = None
    order: Literal["asc", "desc"] = "desc"


class TelemetryPage(ApiModel):
    station_id: str
    filters: TelemetryFilters
    total: int = Field(description="Total readings matching the filters")
    limit: int
    offset: int
    items: list[TelemetryReadingSchema]
