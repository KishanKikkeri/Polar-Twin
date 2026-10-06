"""Raw telemetry query service."""

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AssetNotFoundError, InvalidQueryError
from app.core.timeutil import ensure_utc, utcnow
from app.domain.enums import OBSERVED_STATE_PROVENANCES, Provenance
from app.repositories.telemetry import TelemetryQuery, TelemetryRepository
from app.repositories.topology import AssetRepository
from app.schemas.telemetry import TelemetryFilters, TelemetryReadingSchema
from app.services.station_service import StationService


class TelemetryService:
    def __init__(self, session: Session):
        self.station_service = StationService(session)
        self.assets = AssetRepository(session)
        self.telemetry = TelemetryRepository(session)

    def search(
        self,
        station_id: str,
        filters: TelemetryFilters,
        *,
        limit: int,
        offset: int,
        range_str: str | None = None,
        parameter: str | None = None,
    ) -> list[TelemetryReadingSchema]:
        self.station_service.require_station(station_id)

        if filters.asset_id and self.assets.get_in_station(station_id, filters.asset_id) is None:
            raise AssetNotFoundError(
                f"Asset '{filters.asset_id}' does not exist in station '{station_id}'",
                details={"station_id": station_id, "asset_id": filters.asset_id},
            )

        start = ensure_utc(filters.start) if filters.start else None
        end = ensure_utc(filters.end) if filters.end else None

        # Handle range parameter if provided
        if range_str and not start:
            range_map = {
                "1h": timedelta(hours=1),
                "6h": timedelta(hours=6),
                "24h": timedelta(hours=24),
                "7d": timedelta(days=7),
                "30d": timedelta(days=30),
            }
            delta = range_map.get(range_str)
            if delta:
                anchor = end
                if not anchor:
                    # If end not provided, check if database has readings
                    latest = self.telemetry.latest_per_channel(
                        station_id, provenances=OBSERVED_STATE_PROVENANCES, as_of=utcnow()
                    )
                    if latest:
                        max_obs = max(r.observed_at for r in latest.values())
                        # If latest reading is older than delta, anchor to max_obs so query finds data
                        if (utcnow() - max_obs) > delta:
                            anchor = max_obs
                        else:
                            anchor = utcnow()
                    else:
                        anchor = utcnow()
                start = anchor - delta
                if not end:
                    end = anchor

        metric = parameter or filters.metric

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
                metric=metric,
                provenance=filters.provenance,
                quality=filters.quality,
                start=start,
                end=end,
                order=filters.order,
                limit=limit,
                offset=offset,
            )
        )
        return [TelemetryReadingSchema.model_validate(r) for r in rows]
