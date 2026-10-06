"""Seed topology and deterministic SYNTHETIC telemetry.

Everything produced here is labelled: observed-like values carry provenance
SYNTHETIC, roll-ups DERIVED, the toy forecast PREDICTED and the heating
overlay SIMULATED. Every row's ``source`` starts with ``seed:`` so it can be
identified and removed without touching any other data.
"""

import logging
import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.core.timeutil import ensure_utc, utcnow
from app.domain.enums import Provenance, Quality
from app.models import Asset, Building, Station, TelemetryChannel, TelemetryReading
from app.seed.catalog import STATIONS, ChannelSpec, DerivedSpec, StationSpec

logger = logging.getLogger("polartwin.seed")

SEED_SOURCE_PREFIX = "seed:"
SRC_SYNTHETIC = "seed:synthetic-v1"
SRC_DERIVED = "seed:derived-v1"
SRC_FORECAST = "seed:toy-linear-forecast-v1"
SRC_SIMULATED = "seed:sim-heating-what-if-v1"
HISTORY = timedelta(hours=24)
INGEST_DELAY = timedelta(seconds=20)
SIMULATED_OVERLAY_WINDOW = timedelta(hours=2)
SIMULATED_OFFSET = 12.0


def asset_id(station_id: str, code: str) -> str:
    return f"{station_id}.{code}"


def channel_id(station_id: str, asset_code: str, metric: str) -> str:
    return f"{station_id}.{asset_code}.{metric}"


# ---------------------------------------------------------------------------
# Topology
# ---------------------------------------------------------------------------


def seed_topology(session: Session, stations: tuple[StationSpec, ...] = STATIONS) -> dict[str, int]:
    """Idempotently upsert stations, buildings, assets and channels."""
    counts = {"stations": 0, "buildings": 0, "assets": 0, "channels": 0}
    for st in stations:
        session.merge(
            Station(
                id=st.id, name=st.name, short_name=st.short_name, location=st.location, region=st.region,
                operator=st.operator, purpose=st.purpose, established_year=st.established_year,
                latitude=st.latitude, longitude=st.longitude,
            )
        )
        counts["stations"] += 1
        for b in st.buildings:
            session.merge(
                Building(
                    id=f"{st.id}.{b.code}", station_id=st.id, code=b.code, name=b.name, subtitle=b.subtitle,
                    category=b.category, layout={"position": list(b.position), "size": list(b.size)},
                )
            )
            counts["buildings"] += 1
        for a in st.assets:
            session.merge(
                Asset(
                    id=asset_id(st.id, a.code), station_id=st.id,
                    building_id=f"{st.id}.{a.building_code}" if a.building_code else None,
                    code=a.code, name=a.name, asset_type=a.asset_type, system=a.system, description=a.description,
                )
            )
            counts["assets"] += 1
            for c in a.channels:
                session.merge(
                    TelemetryChannel(
                        id=channel_id(st.id, a.code, c.metric), station_id=st.id, asset_id=asset_id(st.id, a.code),
                        metric=c.metric, unit=c.unit, description=c.description,
                        expected_interval_seconds=c.interval_s, stale_after_seconds=c.interval_s * c.stale_factor,
                        warn_low=c.warn_low, warn_high=c.warn_high, crit_low=c.crit_low, crit_high=c.crit_high,
                    )
                )
                counts["channels"] += 1
    session.flush()
    return counts


# ---------------------------------------------------------------------------
# Synthetic telemetry (pure — no DB access)
# ---------------------------------------------------------------------------


def _timeline(now: datetime, interval_s: int) -> list[datetime]:
    epoch = int(now.timestamp())
    end = datetime.fromtimestamp(epoch - epoch % interval_s, tz=UTC)
    n = int(HISTORY.total_seconds() // interval_s)
    return [end - timedelta(seconds=interval_s * i) for i in range(n - 1, -1, -1)]


def _row(st: StationSpec, asset_code: str, spec: ChannelSpec | DerivedSpec, *, observed_at: datetime,
         ingested_at: datetime, value: float | None, provenance: Provenance, quality: Quality,
         source: str) -> dict[str, Any]:
    return {
        "channel_id": channel_id(st.id, asset_code, spec.metric),
        "station_id": st.id,
        "asset_id": asset_id(st.id, asset_code),
        "metric": spec.metric,
        "observed_at": observed_at,
        "ingested_at": ingested_at,
        "value": value,
        "unit": spec.unit,
        "provenance": provenance,
        "quality": quality,
        "source": source,
    }


def generate_station_telemetry(st: StationSpec, now: datetime) -> list[dict[str, Any]]:
    """Deterministic (per channel) synthetic history ending at ``now``."""
    now = ensure_utc(now)
    rows: list[dict[str, Any]] = []
    series: dict[tuple[str, str], dict[datetime, float | None]] = {}
    solar_offset_h = st.longitude / 15.0

    for asset in st.assets:
        for spec in asset.channels:
            if isinstance(spec, DerivedSpec):
                continue
            key = (asset.code, spec.metric)
            series[key] = {}
            if spec.never_reports:
                continue
            rng = random.Random(channel_id(st.id, asset.code, spec.metric))
            timeline = _timeline(now, spec.interval_s)
            end = timeline[-1]
            for i, ts in enumerate(timeline):
                if spec.stops_reporting_hours_ago is not None and ts > now - timedelta(hours=spec.stops_reporting_hours_ago):
                    continue
                ingested = min(ts + INGEST_DELAY, now)
                in_gap = any(now - timedelta(hours=a) <= ts < now - timedelta(hours=b)
                             for a, b in spec.missing_windows_hours_ago)
                if in_gap:
                    series[key][ts] = None
                    rows.append(_row(st, asset.code, spec, observed_at=ts, ingested_at=ingested, value=None,
                                     provenance=Provenance.SYNTHETIC, quality=Quality.MISSING, source=SRC_SYNTHETIC))
                    continue
                solar_hour = (ts.hour + ts.minute / 60 + solar_offset_h) % 24
                value = (
                    spec.base
                    + spec.drift_per_day * (ts - end).total_seconds() / 86400
                    + spec.diurnal * math.sin(2 * math.pi * (solar_hour - 9) / 24)
                    + rng.gauss(0, spec.noise)
                )
                quality = Quality.GOOD
                if spec.suspect_spike_every and i % spec.suspect_spike_every == spec.suspect_spike_every - 1:
                    value += 15 + 6 * spec.noise
                    quality = Quality.SUSPECT
                value = round(value, spec.decimals)
                series[key][ts] = value if quality == Quality.GOOD else None
                rows.append(_row(st, asset.code, spec, observed_at=ts, ingested_at=ingested, value=value,
                                 provenance=Provenance.SYNTHETIC, quality=quality, source=SRC_SYNTHETIC))
                if spec.simulated_overlay and ts > now - SIMULATED_OVERLAY_WINDOW:
                    rows.append(_row(st, asset.code, spec, observed_at=ts, ingested_at=ingested,
                                     value=round(value + SIMULATED_OFFSET, spec.decimals),
                                     provenance=Provenance.SIMULATED, quality=Quality.GOOD, source=SRC_SIMULATED))

    # DERIVED channels, in catalog order so chained derivations resolve.
    for asset in st.assets:
        for spec in asset.channels:
            if not isinstance(spec, DerivedSpec):
                continue
            key = (asset.code, spec.metric)
            series[key] = {}
            timeline = _timeline(now, spec.interval_s)
            for ts in timeline:
                inputs = [series.get((a, m), {}).get(ts) for a, m, _ in spec.inputs]
                ingested = min(ts + INGEST_DELAY, now)
                if any(v is None for v in inputs):
                    # An input is missing/unusable: the derived value is MISSING, not a partial sum.
                    series[key][ts] = None
                    rows.append(_row(st, asset.code, spec, observed_at=ts, ingested_at=ingested, value=None,
                                     provenance=Provenance.DERIVED, quality=Quality.MISSING, source=SRC_DERIVED))
                    continue
                value = round(sum(v * w for v, (_, _, w) in zip(inputs, spec.inputs)), spec.decimals)
                series[key][ts] = value
                rows.append(_row(st, asset.code, spec, observed_at=ts, ingested_at=ingested, value=value,
                                 provenance=Provenance.DERIVED, quality=Quality.GOOD, source=SRC_DERIVED))

            if spec.predict_hours:
                last_ts = timeline[-1]
                last = series[key].get(last_ts)
                if last is not None:
                    for h in range(1, spec.predict_hours + 1):
                        rows.append(_row(
                            st, asset.code, spec, observed_at=last_ts + timedelta(hours=h), ingested_at=now,
                            value=round(last - spec.predict_rate_per_day * h / 24, spec.decimals),
                            provenance=Provenance.PREDICTED, quality=Quality.GOOD, source=SRC_FORECAST,
                        ))
    return rows


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


@dataclass
class SeedResult:
    topology: dict[str, int]
    telemetry_inserted: dict[str, int]
    telemetry_skipped: list[str]


def seed(
    session: Session,
    *,
    now: datetime | None = None,
    reset_telemetry: bool = False,
    with_telemetry: bool = True,
    stations: tuple[StationSpec, ...] = STATIONS,
) -> SeedResult:
    now = ensure_utc(now) if now else utcnow()
    topology = seed_topology(session, stations)
    inserted: dict[str, int] = {}
    skipped: list[str] = []

    if with_telemetry:
        for st in stations:
            if reset_telemetry:
                session.execute(
                    delete(TelemetryReading).where(
                        TelemetryReading.station_id == st.id,
                        TelemetryReading.source.startswith(SEED_SOURCE_PREFIX),
                    )
                )
            else:
                existing = session.scalar(
                    select(func.count()).select_from(TelemetryReading).where(TelemetryReading.station_id == st.id)
                )
                if existing:
                    skipped.append(st.id)
                    continue
            rows = generate_station_telemetry(st, now)
            if rows:
                session.execute(insert(TelemetryReading), rows)
            inserted[st.id] = len(rows)

    session.commit()
    return SeedResult(topology=topology, telemetry_inserted=inserted, telemetry_skipped=skipped)
