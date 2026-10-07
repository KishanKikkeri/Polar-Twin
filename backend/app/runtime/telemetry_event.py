"""Canonical Telemetry Event and batch models.

This is the standard event contract (§1 in docs/phase4/agent4a-contracts.md)
used across edge simulation, store-and-forward buffers, MQTT transport,
and the ingestion pipeline.
"""

import math
from datetime import UTC, datetime
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.timeutil import utcnow
from app.domain.enums import Provenance, Quality
from app.domain.runtime_enums import IngestOutcome, Ordering, RejectReason, Timeliness


class TelemetryEvent(BaseModel):
    """Canonical telemetry event emitted by edge sensors / simulators."""

    model_config = ConfigDict(extra="ignore")

    event_id: str = Field(description="Unique idempotency identifier (UUID or deterministic hash)")
    station_id: str = Field(description="Target station slug, e.g. 'maitri'")
    asset_id: str = Field(description="Asset ID '<station>.<asset_code>'")
    channel_id: str = Field(description="Channel ID '<asset_id>.<metric>'")
    metric: str = Field(description="Measured or simulated metric name")
    unit: str = Field(description="Engineering physical unit, e.g. 'degC', 'kW'")
    observed_at: AwareDatetime = Field(description="Timestamp when sample was observed at station")
    value: float | None = Field(default=None, description="Observation value (None when quality=MISSING)")
    provenance: Provenance = Field(default=Provenance.SYNTHETIC)
    quality: Quality = Field(default=Quality.GOOD)
    source: str = Field(default="edge:simulator:v1", description="Identifier of the publishing producer")
    sequence_num: int | None = Field(default=None, description="Monotonic sequence number per channel for gap analysis")

    @field_validator("observed_at")
    @classmethod
    def _validate_observed_at(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware UTC")
        return v.astimezone(UTC)

    @field_validator("value")
    @classmethod
    def _validate_finite(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("value must be finite (not NaN or Inf)")
        return v

    @model_validator(mode="after")
    def _check_quality_value_consistency(self) -> "TelemetryEvent":
        if self.quality == Quality.MISSING and self.value is not None:
            raise ValueError("MISSING quality must have value=None")
        if self.quality != Quality.MISSING and self.value is None:
            raise ValueError(f"Quality {self.quality.value} requires a non-null value")
        return self

    @property
    def natural_key(self) -> tuple[str, datetime, Provenance, str]:
        """Natural key for deduplication: (channel_id, observed_at, provenance, source)."""
        return (self.channel_id, self.observed_at, self.provenance, self.source)


class IngestionRecord(BaseModel):
    """Result of processing a TelemetryEvent through the Ingestion Pipeline."""

    model_config = ConfigDict(from_attributes=True)

    event_id: str
    channel_id: str
    station_id: str
    observed_at: AwareDatetime
    received_at: AwareDatetime
    outcome: IngestOutcome
    ordering: Ordering
    timeliness: Timeliness
    reason: RejectReason | None = None
    detail: str | None = None
    flags: list[str] = Field(default_factory=list)


class IngestionBatchResult(BaseModel):
    """Summary of batch ingestion execution."""

    received: int
    accepted: int
    duplicates: int
    conflicts: int
    rejected: int
    out_of_order: int
    delayed: int
    records: list[IngestionRecord] = Field(default_factory=list)
