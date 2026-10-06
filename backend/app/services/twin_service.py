"""Digital Twin overview read model.

Builds the current state of a station from raw telemetry at a reference time
``as_of``. Rules (see docs/API_CONTRACT.md):

* Only observed-state provenances (REAL_OBSERVATION, SYNTHETIC, DERIVED) feed
  current state. PREDICTED/SIMULATED/SCENARIO values can never overwrite it;
  the next prediction is surfaced separately in ``next_prediction``.
* Every expected channel appears, even with no data (freshness=MISSING).
* Missing values stay null; they are never coerced to zero.
"""

from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.timeutil import ensure_utc, utcnow
from app.domain.enums import (
    OBSERVED_STATE_PROVENANCES,
    Condition,
    Freshness,
    Provenance,
    Quality,
)
from app.domain.twin_state import (
    Thresholds,
    evaluate_condition,
    evaluate_freshness,
    rollup_completeness,
    rollup_condition,
)
from app.models import TelemetryChannel, TelemetryReading
from app.repositories.telemetry import TelemetryRepository
from app.repositories.topology import AssetRepository
from app.schemas.overview import (
    AssetState,
    ChannelState,
    ReadingValue,
    StateCounts,
    StationOverview,
    SystemSummary,
)
from app.services.station_service import StationService, to_summary


def _reading_value(r: TelemetryReading | None) -> ReadingValue | None:
    if r is None:
        return None
    return ReadingValue(
        value=r.value,
        unit=r.unit,
        observed_at=r.observed_at,
        provenance=r.provenance,
        quality=r.quality,
        source=r.source,
    )


def _channel_state(
    channel: TelemetryChannel,
    latest: TelemetryReading | None,
    last_valid: TelemetryReading | None,
    prediction: TelemetryReading | None,
    as_of: datetime,
) -> ChannelState:
    freshness = evaluate_freshness(
        latest_observed_at=latest.observed_at if latest else None,
        latest_quality=latest.quality if latest else None,
        as_of=as_of,
        stale_after_seconds=channel.stale_after_seconds,
    )
    condition = evaluate_condition(
        value=latest.value if latest else None,
        quality=latest.quality if latest else None,
        freshness=freshness,
        thresholds=Thresholds(channel.warn_low, channel.warn_high, channel.crit_low, channel.crit_high),
    )
    return ChannelState(
        channel_id=channel.id,
        metric=channel.metric,
        unit=channel.unit,
        freshness=freshness,
        condition=condition,
        latest=_reading_value(latest),
        last_valid=_reading_value(last_valid),
        age_seconds=(as_of - latest.observed_at).total_seconds() if latest else None,
        stale_after_seconds=channel.stale_after_seconds,
        next_prediction=_reading_value(prediction),
    )


class TwinService:
    def __init__(self, session: Session):
        self.station_service = StationService(session)
        self.assets = AssetRepository(session)
        self.telemetry = TelemetryRepository(session)

    def overview(self, station_id: str, as_of: datetime | None = None) -> StationOverview:
        station = self.station_service.require_station(station_id)
        generated_at = utcnow()
        as_of = ensure_utc(as_of) if as_of else generated_at

        latest = self.telemetry.latest_per_channel(
            station_id, provenances=OBSERVED_STATE_PROVENANCES, as_of=as_of
        )
        last_valid = self.telemetry.latest_per_channel(
            station_id, provenances=OBSERVED_STATE_PROVENANCES, as_of=as_of, exclude_missing=True
        )
        predictions = self.telemetry.next_prediction_per_channel(station_id, as_of=as_of)

        asset_states: list[AssetState] = []
        by_system: dict = defaultdict(list)
        for asset in self.assets.list_for_station(station_id):
            channels = [
                _channel_state(c, latest.get(c.id), last_valid.get(c.id), predictions.get(c.id), as_of)
                for c in asset.channels
            ]
            state = AssetState(
                asset_id=asset.id,
                code=asset.code,
                name=asset.name,
                asset_type=asset.asset_type,
                system=asset.system,
                building_id=asset.building_id,
                condition=rollup_condition(c.condition for c in channels),
                completeness=rollup_completeness(c.freshness for c in channels),
                channels=channels,
            )
            asset_states.append(state)
            by_system[asset.system].append(state)

        all_channels = [c for a in asset_states for c in a.channels]
        systems = [
            SystemSummary(
                system=system,
                condition=rollup_condition(c.condition for a in states for c in a.channels),
                completeness=rollup_completeness(c.freshness for a in states for c in a.channels),
                asset_count=len(states),
                channel_count=sum(len(a.channels) for a in states),
            )
            for system, states in sorted(by_system.items(), key=lambda kv: kv[0].value)
        ]

        provenance_counts = Counter(c.latest.provenance for c in all_channels if c.latest)
        quality_counts = Counter(c.latest.quality for c in all_channels if c.latest)
        counts = StateCounts(
            channels_total=len(all_channels),
            by_freshness={f: sum(1 for c in all_channels if c.freshness == f) for f in Freshness},
            by_condition={k: sum(1 for c in all_channels if c.condition == k) for k in Condition},
            by_quality={q: quality_counts.get(q, 0) for q in Quality},
            by_provenance={p: provenance_counts.get(p, 0) for p in Provenance},
        )

        contains_real = provenance_counts.get(Provenance.REAL_OBSERVATION, 0) > 0
        notice = None
        if not contains_real:
            notice = (
                "No REAL_OBSERVATION telemetry is available for this station. Current values are "
                "SYNTHETIC/DERIVED development data and do not reflect actual station conditions."
            )

        return StationOverview(
            station=to_summary(station),
            as_of=as_of,
            generated_at=generated_at,
            condition=rollup_condition(c.condition for c in all_channels),
            completeness=rollup_completeness(c.freshness for c in all_channels),
            contains_real_observations=contains_real,
            data_notice=notice,
            counts=counts,
            systems=systems,
            assets=asset_states,
        )
