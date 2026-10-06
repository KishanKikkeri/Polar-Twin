"""Raw telemetry schemas."""

from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from app.domain.enums import Provenance, Quality
from app.schemas.common import ApiModel


class TelemetryReadingSchema(ApiModel):
    """A single raw reading exactly as stored. ``value`` is null iff quality is MISSING."""

    id: int
    telemetry_id: str | None = None
    station_id: str
    channel_id: str
    sensor_id: str | None = None
    asset_id: str
    metric: str
    parameter: str | None = None
    observed_at: AwareDatetime = Field(description="When the value applies (UTC, ISO 8601)")
    timestamp: AwareDatetime | None = None
    ingested_at: AwareDatetime = Field(description="When the platform received the value (UTC)")
    value: float | None = Field(description="Null only when quality is MISSING — never coerced to 0")
    unit: str
    provenance: Provenance
    source_type: Provenance | None = None
    quality: Quality
    source: str

    @model_validator(mode="after")
    def populate_aliases(self) -> "TelemetryReadingSchema":
        if not self.telemetry_id:
            self.telemetry_id = str(self.id)
        if not self.sensor_id:
            self.sensor_id = self.channel_id
        if not self.parameter:
            self.parameter = self.metric
        if not self.timestamp:
            self.timestamp = self.observed_at
        if not self.source_type:
            self.source_type = self.provenance
        return self


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
