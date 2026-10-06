"""Queries over raw telemetry."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.domain.enums import Provenance, Quality
from app.models import TelemetryChannel, TelemetryReading


@dataclass(frozen=True)
class TelemetryQuery:
    station_id: str
    asset_id: str | None = None
    metric: str | None = None
    provenance: Sequence[Provenance] | None = None
    quality: Sequence[Quality] | None = None
    start: datetime | None = None
    end: datetime | None = None
    order: str = "desc"
    limit: int = 500
    offset: int = 0


class TelemetryRepository:
    def __init__(self, session: Session):
        self.session = session

    # ---- raw queries -------------------------------------------------------

    def _filtered(self, q: TelemetryQuery) -> Select:
        stmt = select(TelemetryReading).where(TelemetryReading.station_id == q.station_id)
        if q.asset_id:
            stmt = stmt.where(TelemetryReading.asset_id == q.asset_id)
        if q.metric:
            stmt = stmt.where(TelemetryReading.metric == q.metric)
        if q.provenance:
            stmt = stmt.where(TelemetryReading.provenance.in_(list(q.provenance)))
        if q.quality:
            stmt = stmt.where(TelemetryReading.quality.in_(list(q.quality)))
        if q.start is not None:
            stmt = stmt.where(TelemetryReading.observed_at >= q.start)
        if q.end is not None:
            stmt = stmt.where(TelemetryReading.observed_at <= q.end)
        return stmt

    def search(self, q: TelemetryQuery) -> tuple[int, Sequence[TelemetryReading]]:
        base = self._filtered(q)
        total = self.session.scalar(select(func.count()).select_from(base.subquery())) or 0
        if q.order == "asc":
            ordering = (TelemetryReading.observed_at.asc(), TelemetryReading.id.asc())
        else:
            ordering = (TelemetryReading.observed_at.desc(), TelemetryReading.id.desc())
        rows = self.session.scalars(base.order_by(*ordering).limit(q.limit).offset(q.offset)).all()
        return total, rows

    # ---- read-model support -----------------------------------------------

    def latest_per_channel(
        self,
        station_id: str,
        *,
        provenances: Iterable[Provenance],
        as_of: datetime,
        exclude_missing: bool = False,
    ) -> dict[str, TelemetryReading]:
        """Most recent reading per channel with observed_at <= as_of.

        Ties on observed_at are broken by insertion order (highest id wins).
        Only readings already ingested by ``as_of`` are considered, so
        replaying the twin at a past time never leaks later data.
        """
        conditions = [
            TelemetryReading.station_id == station_id,
            TelemetryReading.provenance.in_(list(provenances)),
            TelemetryReading.observed_at <= as_of,
            TelemetryReading.ingested_at <= as_of,
        ]
        if exclude_missing:
            conditions.append(TelemetryReading.quality != Quality.MISSING)

        ranked = (
            select(
                TelemetryReading.id.label("rid"),
                func.row_number()
                .over(
                    partition_by=TelemetryReading.channel_id,
                    order_by=(TelemetryReading.observed_at.desc(), TelemetryReading.id.desc()),
                )
                .label("rn"),
            )
            .where(*conditions)
            .subquery()
        )
        stmt = select(TelemetryReading).join(ranked, ranked.c.rid == TelemetryReading.id).where(ranked.c.rn == 1)
        return {r.channel_id: r for r in self.session.scalars(stmt)}

    def next_prediction_per_channel(self, station_id: str, *, as_of: datetime) -> dict[str, TelemetryReading]:
        """Earliest PREDICTED reading per channel targeting a time after as_of."""
        ranked = (
            select(
                TelemetryReading.id.label("rid"),
                func.row_number()
                .over(
                    partition_by=TelemetryReading.channel_id,
                    order_by=(TelemetryReading.observed_at.asc(), TelemetryReading.id.desc()),
                )
                .label("rn"),
            )
            .where(
                TelemetryReading.station_id == station_id,
                TelemetryReading.provenance == Provenance.PREDICTED,
                TelemetryReading.observed_at > as_of,
                TelemetryReading.ingested_at <= as_of,
            )
            .subquery()
        )
        stmt = select(TelemetryReading).join(ranked, ranked.c.rid == TelemetryReading.id).where(ranked.c.rn == 1)
        return {r.channel_id: r for r in self.session.scalars(stmt)}

    # ---- writes ------------------------------------------------------------

    def add_many(self, readings: Iterable[TelemetryReading]) -> None:
        self.session.add_all(list(readings))

    def channels_for_station(self, station_id: str) -> Sequence[TelemetryChannel]:
        return self.session.scalars(
            select(TelemetryChannel).where(TelemetryChannel.station_id == station_id)
        ).all()
