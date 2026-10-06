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
    OverviewAlert,
    OverviewRisk,
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
                building_id=asset.building_id.split(".")[-1] if asset.building_id else None,
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

        overall_condition = rollup_condition(c.condition for c in all_channels)
        overall_completeness = rollup_completeness(c.freshness for c in all_channels)

        # Build frontend-specific integration fields
        # 1. status
        status_map = {
            Condition.NORMAL: "operational",
            Condition.WARNING: "degraded",
            Condition.CRITICAL: "degraded",
            Condition.UNKNOWN: "unknown",
        }
        frontend_status = status_map.get(overall_condition, "unknown")

        # 2. last_updated
        timestamps = [c.latest.observed_at for c in all_channels if c.latest]
        last_updated = max(timestamps) if timestamps else as_of

        # 3. data_status
        data_status = "REAL_OBSERVATION" if contains_real else "SYNTHETIC"

        # 4. domains
        # Quick lookup for latest values
        val_map: dict[str, float | None] = {}
        for c in all_channels:
            val_map[c.channel_id] = c.latest.value if c.latest else None

        env_domain = {
            "air_temperature": val_map.get(f"{station_id}.aws-1.air_temp_c"),
            "wind": val_map.get(f"{station_id}.aws-1.wind_speed_ms"),
            "indoor_temperature": val_map.get(f"{station_id}.indoor-env-main.air_temp_c"),
            "co2_ppm": val_map.get(f"{station_id}.indoor-env-main.co2_ppm"),
        }
        energy_domain = {
            "total_load_kw": val_map.get(f"{station_id}.power-bus.station_load_kw"),
            "voltage_v": val_map.get(f"{station_id}.power-bus.voltage_v"),
            "frequency_hz": val_map.get(f"{station_id}.power-bus.frequency_hz"),
            "fuel_storage_pct": val_map.get(f"{station_id}.tank-a.level_pct"),
        }
        logistics_domain = {
            "fuel_days_of_autonomy": val_map.get(f"{station_id}.fuel-inventory.days_of_autonomy_d"),
            "water_storage_pct": val_map.get(f"{station_id}.water-tank.level_pct"),
            "waste_storage_pct": val_map.get(f"{station_id}.incinerator-1.storage_pct") or val_map.get(f"{station_id}.wwtp-1.buffer_tank_pct"),
        }
        infra_domain = {
            "boiler_supply_temp_c": val_map.get(f"{station_id}.boiler-1.supply_temp_c") or val_map.get(f"{station_id}.heat-exchanger-1.supply_temp_c"),
            "satellite_latency_ms": val_map.get(f"{station_id}.satcom-1.latency_ms"),
            "satellite_bandwidth_mbps": val_map.get(f"{station_id}.satcom-1.bandwidth_mbps"),
        }
        domains = {
            "environment": env_domain,
            "energy": energy_domain,
            "logistics": logistics_domain,
            "infrastructure": infra_domain,
        }

        # 5. active_alerts
        active_alerts: list[OverviewAlert] = []
        for a in asset_states:
            for c in a.channels:
                if c.condition in (Condition.WARNING, Condition.CRITICAL):
                    active_alerts.append(
                        OverviewAlert(
                            alert_id=f"alt-{c.channel_id}",
                            station_id=station_id,
                            source=a.name,
                            severity="CRITICAL" if c.condition == Condition.CRITICAL else "WARNING",
                            title=f"{a.name} — {c.metric.replace('_', ' ').upper()}",
                            description=f"Current value {c.latest.value if c.latest else '—'} {c.unit} triggered {c.condition.value} threshold",
                            created_at=c.latest.observed_at if c.latest else as_of,
                            recommended_action=f"Inspect {a.name} in {a.building_id or 'station area'}",
                        )
                    )

        # 6. risk
        if overall_condition == Condition.NORMAL:
            risk = OverviewRisk(score=12.0, severity="low", contributing_factors=[], trend="stable")
        elif overall_condition == Condition.WARNING:
            factors = [alt.title for alt in active_alerts]
            risk = OverviewRisk(score=45.0, severity="medium", contributing_factors=factors, trend="elevated")
        elif overall_condition == Condition.CRITICAL:
            factors = [alt.title for alt in active_alerts]
            risk = OverviewRisk(score=82.0, severity="high", contributing_factors=factors, trend="critical")
        else:
            risk = OverviewRisk(score=None, severity="unknown", contributing_factors=[], trend=None)

        return StationOverview(
            station=to_summary(station),
            as_of=as_of,
            generated_at=generated_at,
            condition=overall_condition,
            completeness=overall_completeness,
            contains_real_observations=contains_real,
            data_notice=notice,
            counts=counts,
            systems=systems,
            assets=asset_states,
            station_id=station.id,
            station_name=station.name,
            status=frontend_status,
            last_updated=last_updated,
            data_status=data_status,
            domains=domains,
            active_alerts=active_alerts,
            risk=risk,
        )
