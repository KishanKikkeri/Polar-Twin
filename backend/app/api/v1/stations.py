"""Station, asset, telemetry and twin-overview endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.domain.enums import Provenance, Quality, SystemType
from app.schemas.common import ERROR_RESPONSES
from app.schemas.overview import StationOverview
from app.schemas.station import AssetSchema, StationDetail, StationSummary
from app.schemas.telemetry import TelemetryFilters, TelemetryReadingSchema
from app.services.station_service import StationService
from app.services.telemetry_service import TelemetryService
from app.services.twin_service import TwinService

router = APIRouter(prefix="/stations", tags=["stations"])

StationId = Annotated[
    str,
    Path(min_length=1, max_length=32, description="Stable station ID", examples=["maitri", "bharati"]),
]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[StationSummary], summary="List stations")
def list_stations(db: DbSession) -> list[StationSummary]:
    return StationService(db).list_stations()


@router.get(
    "/{station_id}",
    response_model=StationDetail,
    summary="Station detail with buildings",
    responses=ERROR_RESPONSES,
)
def get_station(station_id: StationId, db: DbSession) -> StationDetail:
    return StationService(db).get_station(station_id)


@router.get(
    "/{station_id}/overview",
    response_model=StationOverview,
    summary="Digital Twin overview (aggregated current state)",
    description=(
        "Read model computed from raw telemetry at `as_of` (default: now). Every expected channel is "
        "listed with explicit freshness (FRESH/STALE/MISSING), condition, quality and provenance. "
        "Also provides frontend v1 domain metrics, active alerts, and risk score."
    ),
    responses=ERROR_RESPONSES,
)
def get_overview(
    station_id: StationId,
    db: DbSession,
    as_of: Annotated[
        AwareDatetime | None,
        Query(description="Reference time (ISO 8601 with timezone). Defaults to now."),
    ] = None,
) -> StationOverview:
    return TwinService(db).overview(station_id, as_of=as_of)


@router.get(
    "/{station_id}/assets",
    response_model=list[AssetSchema],
    summary="Assets and their expected telemetry channels",
    responses=ERROR_RESPONSES,
)
def list_assets(
    station_id: StationId,
    db: DbSession,
    system: Annotated[SystemType | None, Query(description="Filter by infrastructure system")] = None,
    building_id: Annotated[str | None, Query(description="Filter by building ID")] = None,
) -> list[AssetSchema]:
    return StationService(db).list_assets(station_id, system=system, building_id=building_id)


@router.get(
    "/{station_id}/telemetry",
    response_model=list[TelemetryReadingSchema],
    summary="Raw telemetry readings",
    description=(
        "Raw readings exactly as stored, with provenance and quality preserved. "
        "MISSING readings have `value: null`. Supports time range and parameter queries."
    ),
    responses=ERROR_RESPONSES,
)
def list_telemetry(
    station_id: StationId,
    db: DbSession,
    asset_id: Annotated[str | None, Query(description="e.g. maitri.dg-1")] = None,
    metric: Annotated[str | None, Query(description="e.g. load_kw")] = None,
    parameter: Annotated[str | None, Query(description="Alias for metric")] = None,
    range: Annotated[Literal["1h", "6h", "24h", "7d", "30d"] | None, Query(description="Time window")] = None,
    provenance: Annotated[list[Provenance] | None, Query(description="Repeatable")] = None,
    quality: Annotated[list[Quality] | None, Query(description="Repeatable")] = None,
    start: Annotated[AwareDatetime | None, Query(description="observed_at >= start")] = None,
    end: Annotated[AwareDatetime | None, Query(description="observed_at <= end")] = None,
    order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    limit: Annotated[int | None, Query(ge=1, description="Default 500, max 5000")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TelemetryReadingSchema]:
    filters = TelemetryFilters(
        asset_id=asset_id,
        metric=metric or parameter,
        provenance=provenance,
        quality=quality,
        start=start,
        end=end,
        order=order,
    )
    effective_limit = limit if limit is not None else get_settings().telemetry_default_limit
    return TelemetryService(db).search(
        station_id,
        filters,
        limit=effective_limit,
        offset=offset,
        range_str=range,
        parameter=parameter,
    )
