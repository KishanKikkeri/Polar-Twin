"""Station, building and asset schemas (static topology)."""

from typing import Any

from pydantic import AwareDatetime, Field, model_validator

from app.domain.enums import AssetType, BuildingCategory, SystemType
from app.schemas.common import ApiModel, Coordinates


class StationSummary(ApiModel):
    id: str = Field(description="Stable station ID", examples=["maitri"])
    station_id: str | None = Field(default=None, description="Frontend alias for id")
    name: str = Field(examples=["Maitri Research Station"])
    station_name: str | None = Field(default=None, description="Frontend alias for name")
    short_name: str = Field(examples=["Maitri"])
    status: str = Field(default="operational", description="operational | degraded | offline | unknown")
    location: str
    region: str | None = None
    operator: str
    established_year: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    coordinates: Coordinates

    @model_validator(mode="after")
    def populate_aliases(self) -> "StationSummary":
        if not self.station_id:
            self.station_id = self.id
        if not self.station_name:
            self.station_name = self.name
        if self.latitude is None:
            self.latitude = self.coordinates.lat
        if self.longitude is None:
            self.longitude = self.coordinates.lon
        return self


class BuildingSchema(ApiModel):
    id: str = Field(description="Stable building ID '<station>.<code>'", examples=["maitri.power-house"])
    building_id: str | None = None
    code: str = Field(description="Matches the frontend scene object id", examples=["power-house"])
    name: str
    subtitle: str | None = None
    category: BuildingCategory
    layout: dict[str, Any] | None = Field(
        default=None, description="Schematic scene placement {position, size}; not survey-grade"
    )
    asset_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def populate_aliases(self) -> "BuildingSchema":
        if not self.building_id:
            self.building_id = self.id
        return self


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
    asset_id: str | None = None
    station_id: str
    building_id: str | None = None
    code: str
    name: str
    asset_type: AssetType
    system: SystemType
    description: str | None = None
    status: str = Field(default="operational", description="operational | degraded | failed | maintenance | unknown")
    health: float | None = Field(default=95.0, description="Asset health score")
    criticality: str | None = Field(default="high", description="high | medium | low")
    channels: list[ChannelSchema] = Field(default_factory=list)

    @model_validator(mode="after")
    def populate_aliases(self) -> "AssetSchema":
        if not self.asset_id:
            self.asset_id = self.id
        return self


class AssetListResponse(ApiModel):
    station_id: str
    items: list[AssetSchema]
    count: int
