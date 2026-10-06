"""Station, building and asset schemas (static topology)."""

from typing import Any

from pydantic import AwareDatetime, Field

from app.domain.enums import AssetType, BuildingCategory, SystemType
from app.schemas.common import ApiModel, Coordinates


class StationSummary(ApiModel):
    id: str = Field(description="Stable station ID", examples=["maitri"])
    name: str = Field(examples=["Maitri Research Station"])
    short_name: str = Field(examples=["Maitri"])
    location: str
    region: str | None = None
    operator: str
    established_year: int | None = None
    coordinates: Coordinates


class BuildingSchema(ApiModel):
    id: str = Field(description="Stable building ID '<station>.<code>'", examples=["maitri.power-house"])
    code: str = Field(description="Matches the frontend scene object id", examples=["power-house"])
    name: str
    subtitle: str | None = None
    category: BuildingCategory
    layout: dict[str, Any] | None = Field(
        default=None, description="Schematic scene placement {position, size}; not survey-grade"
    )
    asset_ids: list[str] = Field(default_factory=list)


class StationDetail(StationSummary):
    purpose: str | None = None
    buildings: list[BuildingSchema]
    asset_count: int
    channel_count: int
    updated_at: AwareDatetime


class StationListResponse(ApiModel):
    items: list[StationSummary]
    count: int


class ChannelSchema(ApiModel):
    id: str = Field(examples=["maitri.dg-1.load_kw"])
    metric: str = Field(examples=["load_kw"])
    unit: str = Field(examples=["kW"])
    description: str | None = None
    expected_interval_seconds: int
    stale_after_seconds: int
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None


class AssetSchema(ApiModel):
    id: str = Field(examples=["maitri.dg-1"])
    station_id: str
    building_id: str | None = None
    code: str
    name: str
    asset_type: AssetType
    system: SystemType
    description: str | None = None
    channels: list[ChannelSchema]


class AssetListResponse(ApiModel):
    station_id: str
    items: list[AssetSchema]
    count: int
