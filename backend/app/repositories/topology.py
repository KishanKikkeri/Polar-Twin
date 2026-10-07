"""Queries for static topology."""

# Needed on Python < 3.14: StationRepository defines a method named `list`, which
# shadows the builtin inside the class body, so a later `list[str]` annotation
# would otherwise evaluate to that method and crash at import time.
from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.domain.enums import SystemType
from app.models import Asset, Building, Station, TelemetryChannel


class StationRepository:
    def __init__(self, session: Session):
        self.session = session

    def list(self) -> Sequence[Station]:
        return self.session.scalars(select(Station).order_by(Station.id)).all()

    def list_ids(self) -> list[str]:
        return list(self.session.scalars(select(Station.id).order_by(Station.id)))

    def get(self, station_id: str) -> Station | None:
        return self.session.get(Station, station_id)

    def get_with_buildings(self, station_id: str) -> Station | None:
        stmt = (
            select(Station)
            .where(Station.id == station_id)
            .options(selectinload(Station.buildings).selectinload(Building.assets))
        )
        return self.session.scalars(stmt).first()

    def count_assets(self, station_id: str) -> int:
        return self.session.scalar(
            select(func.count()).select_from(Asset).where(Asset.station_id == station_id)
        ) or 0

    def count_channels(self, station_id: str) -> int:
        return self.session.scalar(
            select(func.count())
            .select_from(TelemetryChannel)
            .where(TelemetryChannel.station_id == station_id)
        ) or 0


class AssetRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_for_station(
        self,
        station_id: str,
        *,
        system: SystemType | None = None,
        building_id: str | None = None,
    ) -> Sequence[Asset]:
        stmt = (
            select(Asset)
            .where(Asset.station_id == station_id)
            .options(selectinload(Asset.channels))
            .order_by(Asset.code)
        )
        if system is not None:
            stmt = stmt.where(Asset.system == system)
        if building_id is not None:
            stmt = stmt.where(Asset.building_id == building_id)
        return self.session.scalars(stmt).all()

    def get_in_station(self, station_id: str, asset_id: str) -> Asset | None:
        stmt = select(Asset).where(Asset.station_id == station_id, Asset.id == asset_id)
        return self.session.scalars(stmt).first()
