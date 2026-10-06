"""Raw telemetry query service."""

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AssetNotFoundError, InvalidQueryError
from app.core.timeutil import ensure_utc
from app.repositories.telemetry import TelemetryQuery, TelemetryRepository
from app.repositories.topology import AssetRepository
from app.schemas.telemetry import TelemetryFilters, TelemetryPage, TelemetryReadingSchema
from app.services.station_service import StationService


class TelemetryService:
    def __init__(self, session: Session):
        self.station_service = StationService(session)
        self.assets = AssetRepository(session)
        self.telemetry = TelemetryRepository(session)

    def search(self, station_id: str, filters: TelemetryFilters, *, limit: int, offset: int) -> TelemetryPage:
        self.station_service.require_station(station_id)

        if filters.asset_id and self.assets.get_in_station(station_id, filters.asset_id) is None:
            raise AssetNotFoundError(
                f"Asset '{filters.asset_id}' does not exist in station '{station_id}'",
                details={"station_id": station_id, "asset_id": filters.asset_id},
            )

        start = ensure_utc(filters.start) if filters.start else None
        end = ensure_utc(filters.end) if filters.end else None
        if start and end and start > end:
            raise InvalidQueryError(
                "'start' must be earlier than or equal to 'end'",
                details={"start": start, "end": end},
            )

        max_limit = get_settings().telemetry_max_limit
        if limit > max_limit:
            raise InvalidQueryError(f"'limit' must be <= {max_limit}", details={"limit": limit})

        total, rows = self.telemetry.search(
            TelemetryQuery(
                station_id=station_id,
                asset_id=filters.asset_id,
                metric=filters.metric,
                provenance=filters.provenance,
                quality=filters.quality,
                start=start,
                end=end,
                order=filters.order,
                limit=limit,
                offset=offset,
            )
        )
        return TelemetryPage(
            station_id=station_id,
            filters=filters,
            total=total,
            limit=limit,
            offset=offset,
            items=[TelemetryReadingSchema.model_validate(r) for r in rows],
        )
