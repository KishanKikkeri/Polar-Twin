"""Digital Twin overview read model.

This is an *aggregated projection* over raw telemetry, computed at ``as_of``.
It is never persisted back into the raw telemetry table.
"""

from typing import Any

from pydantic import AwareDatetime, Field

from app.domain.enums import (
    AssetType,
    Condition,
    DataCompleteness,
    Freshness,
    Provenance,
    Quality,
    SystemType,
)
from app.schemas.common import ApiModel
from app.schemas.station import StationSummary


class ReadingValue(ApiModel):
    value: float | None = Field(description="Null when quality is MISSING")
    unit: str
    observed_at: AwareDatetime
    provenance: Provenance
    quality: Quality
    source: str


class ChannelState(ApiModel):
    channel_id: str
    metric: str
    unit: str
    freshness: Freshness
    condition: Condition
    latest: ReadingValue | None = Field(
        description=(
            "Most recent observed-state record (REAL_OBSERVATION / SYNTHETIC / DERIVED) at or before "
            "as_of. May be an explicit MISSING gap record. Null if the channel never reported."
        )
    )
    last_valid: ReadingValue | None = Field(
        description="Most recent observed-state record that carries a value (quality != MISSING)"
    )
    age_seconds: float | None = Field(description="as_of minus latest.observed_at; null if never reported")
    stale_after_seconds: int
    next_prediction: ReadingValue | None = Field(
        default=None,
        description=(
            "Earliest PREDICTED value targeting a time after as_of. Informational only — "
            "never substitutes for observed state."
        ),
    )


class AssetState(ApiModel):
    asset_id: str
    code: str
    name: str
    asset_type: AssetType
    system: SystemType
    building_id: str | None
    condition: Condition
    completeness: DataCompleteness
    channels: list[ChannelState]


class SystemSummary(ApiModel):
    system: SystemType
    condition: Condition
    completeness: DataCompleteness
    asset_count: int
    channel_count: int


class StateCounts(ApiModel):
    channels_total: int
    by_freshness: dict[Freshness, int]
    by_condition: dict[Condition, int]
    by_quality: dict[Quality, int] = Field(description="Quality of each channel's latest record (if any)")
    by_provenance: dict[Provenance, int] = Field(description="Provenance of each channel's latest record (if any)")


class OverviewAlert(ApiModel):
    alert_id: str
    station_id: str
    source: str
    severity: str = Field(description="INFO | WARNING | HIGH | CRITICAL")
    title: str
    description: str
    created_at: AwareDatetime
    status: str = "ACTIVE"
    recommended_action: str | None = None


class OverviewRisk(ApiModel):
    score: float | None = None
    severity: str = Field(default="low", description="low | medium | high | critical | unknown")
    contributing_factors: list[str] = Field(default_factory=list)
    trend: str | None = "stable"


class StationOverview(ApiModel):
    # Core digital twin fields
    station: StationSummary
    as_of: AwareDatetime = Field(description="Reference time used for freshness evaluation")
    generated_at: AwareDatetime
    condition: Condition
    completeness: DataCompleteness
    contains_real_observations: bool = Field(
        description="True only if at least one current value has provenance REAL_OBSERVATION"
    )
    data_notice: str | None = Field(description="Human-readable caveat about the data's origin")
    counts: StateCounts
    systems: list[SystemSummary]
    assets: list[AssetState]

    # Frontend integration fields (src/types/api.js contract)
    station_id: str = Field(description="Station slug, e.g. 'maitri'")
    station_name: str = Field(description="Station name")
    status: str = Field(default="operational", description="operational | degraded | offline | unknown")
    last_updated: AwareDatetime = Field(description="Latest data timestamp")
    data_status: str = Field(description="SIMULATED | SYNTHETIC | REAL_OBSERVATION")
    domains: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="Domains payload: environment, energy, logistics, infrastructure",
    )
    active_alerts: list[OverviewAlert] = Field(default_factory=list)
    risk: OverviewRisk = Field(default_factory=OverviewRisk)
