"""Station and asset services."""

from sqlalchemy.orm import Session

from app.core.errors import StationNotFoundError
from app.domain.enums import SystemType
from app.models import Station
from app.repositories.topology import AssetRepository, StationRepository
from app.schemas.common import Coordinates
from app.schemas.station import (
    AssetSchema,
    BuildingSchema,
    StationDetail,
    StationSummary,
)


def to_summary(station: Station) -> StationSummary:
    return StationSummary(
        id=station.id,
        name=station.name,
        short_name=station.short_name,
        status="operational",
        location=station.location,
        region=station.region,
        operator=station.operator,
        established_year=station.established_year,
        coordinates=Coordinates(lat=station.latitude, lon=station.longitude),
    )


class StationService:
    def __init__(self, session: Session):
        self.stations = StationRepository(session)
        self.assets = AssetRepository(session)

    def require_station(self, station_id: str) -> Station:
        station = self.stations.get(station_id)
        if station is None:
            raise StationNotFoundError(
                f"Station '{station_id}' does not exist",
                details={"station_id": station_id, "known_station_ids": self.stations.list_ids()},
            )
        return station

    def list_stations(self) -> list[StationSummary]:
        return [to_summary(s) for s in self.stations.list()]

    def get_station(self, station_id: str) -> StationDetail:
        self.require_station(station_id)
        station = self.stations.get_with_buildings(station_id)
        assert station is not None
        buildings = [
            BuildingSchema(
                id=b.id,
                code=b.code,
                name=b.name,
                subtitle=b.subtitle,
                category=b.category,
                layout=b.layout,
                asset_ids=[a.id for a in b.assets],
            )
            for b in station.buildings
        ]
        return StationDetail(
            **to_summary(station).model_dump(),
            purpose=station.purpose,
            buildings=buildings,
            asset_count=self.stations.count_assets(station_id),
            channel_count=self.stations.count_channels(station_id),
            updated_at=station.updated_at,
        )

    def list_assets(
        self, station_id: str, *, system: SystemType | None = None, building_id: str | None = None
    ) -> list[AssetSchema]:
        self.require_station(station_id)
        assets = self.assets.list_for_station(station_id, system=system, building_id=building_id)
        items = []
        for a in assets:
            # Match 3D scene objects by using the building's code (e.g. 'power-house')
            # rather than '<station>.<code>' so groupAssetsByObject links seamlessly.
            scene_building_id = a.building_id.split(".")[-1] if a.building_id else None
            items.append(
                AssetSchema(
                    id=a.id,
                    asset_id=a.id,
                    station_id=a.station_id,
                    building_id=scene_building_id,
                    code=a.code,
                    name=a.name,
                    asset_type=a.asset_type,
                    system=a.system,
                    description=a.description,
                    status="operational",
                    health=95.0,
                    criticality="high" if a.system in (SystemType.ELECTRICITY, SystemType.FUEL, SystemType.HEATING) else "medium",
                    channels=[c for c in a.channels],
                )
            )
        return items
