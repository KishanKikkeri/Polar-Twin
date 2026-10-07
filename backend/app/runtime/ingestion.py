"""Ingestion pipeline abstraction.

Validates raw telemetry events, enforces domain invariants, detects duplicates
and conflicts, categorizes ordering (in-order vs out-of-order) and timeliness
(on-time vs delayed), records metrics, and persists to the database.
"""

from collections import deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.timeutil import ensure_utc, utcnow
from app.domain.enums import OBSERVED_STATE_PROVENANCES, Provenance, Quality
from app.domain.runtime_enums import (
    EventType,
    IngestOutcome,
    Ordering,
    RejectReason,
    Timeliness,
)
from app.models.runtime import TwinEvent
from app.models.telemetry import TelemetryReading
from app.models.topology import TelemetryChannel
from app.observability.metrics import REGISTRY, MetricsRegistry
from app.runtime.telemetry_event import IngestionBatchResult, IngestionRecord, TelemetryEvent

logger = get_logger("polartwin.ingest")


@dataclass
class ChannelWatermark:
    """Tracks latest observed reading and sequence state for a channel."""
    channel_id: str
    latest_observed_at: datetime | None = None
    latest_value: float | None = None
    latest_quality: Quality | None = None
    last_sequence_num: int | None = None
    updated_at: datetime = field(default_factory=utcnow)


class IngestionPipeline:
    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        registry: MetricsRegistry = REGISTRY,
        channel_cache: dict[str, TelemetryChannel] | None = None,
    ):
        self.session = session
        self.settings = settings or get_settings()
        self.registry = registry

        # Counters & gauges
        self.counter_received = registry.counter("polartwin_ingest_received_total", "Total raw events received")
        self.counter_accepted = registry.counter("polartwin_ingest_accepted_total", "Events successfully accepted")
        self.counter_duplicates = registry.counter("polartwin_ingest_duplicates_total", "Duplicate events dropped")
        self.counter_conflicts = registry.counter("polartwin_ingest_conflicts_total", "Conflicting events rejected")
        self.counter_rejected = registry.counter("polartwin_ingest_rejected_total", "Validation rejections by reason")
        self.counter_out_of_order = registry.counter("polartwin_ingest_out_of_order_total", "Out of order events")
        self.counter_delayed = registry.counter("polartwin_ingest_delayed_total", "Delayed / store-and-forward events")
        self.latency = registry.histogram("polartwin_ingest_processing_seconds", "Ingestion pipeline latency")

        # In-memory channel metadata & deduplication lookups
        self.channels: dict[str, TelemetryChannel] = channel_cache if channel_cache is not None else self._load_channels()
        self.watermarks: dict[str, ChannelWatermark] = {}
        # Recent natural keys in-memory ring buffer (natural_key -> value)
        self._recent_keys: dict[tuple[str, datetime, Provenance, str], float | None] = {}
        self._recent_event_ids: set[str] = set()

    def _load_channels(self) -> dict[str, TelemetryChannel]:
        rows = self.session.scalars(select(TelemetryChannel)).all()
        return {c.id: c for c in rows}

    def refresh_topology(self) -> None:
        self.channels = self._load_channels()

    def process_one(self, event: TelemetryEvent, received_at: datetime | None = None) -> IngestionRecord:
        """Process a single event through validation, dedup, and ordering classification."""
        rcv = ensure_utc(received_at) if received_at else utcnow()
        self.counter_received.inc(station=event.station_id)

        # 1. Topology & metadata validation
        channel = self.channels.get(event.channel_id)
        if not channel:
            self.counter_rejected.inc(reason=RejectReason.UNKNOWN_CHANNEL.value)
            return IngestionRecord(
                event_id=event.event_id,
                channel_id=event.channel_id,
                station_id=event.station_id,
                observed_at=event.observed_at,
                received_at=rcv,
                outcome=IngestOutcome.REJECTED,
                ordering=Ordering.IN_ORDER,
                timeliness=Timeliness.ON_TIME,
                reason=RejectReason.UNKNOWN_CHANNEL,
                detail=f"Channel '{event.channel_id}' not found in registered topology",
            )

        if channel.station_id != event.station_id:
            self.counter_rejected.inc(reason=RejectReason.TOPOLOGY_MISMATCH.value)
            return IngestionRecord(
                event_id=event.event_id,
                channel_id=event.channel_id,
                station_id=event.station_id,
                observed_at=event.observed_at,
                received_at=rcv,
                outcome=IngestOutcome.REJECTED,
                ordering=Ordering.IN_ORDER,
                timeliness=Timeliness.ON_TIME,
                reason=RejectReason.TOPOLOGY_MISMATCH,
                detail=f"Channel station '{channel.station_id}' does not match event station '{event.station_id}'",
            )

        # 2. Time boundaries validation
        max_future = timedelta(seconds=self.settings.ingest_max_future_skew_seconds)
        if event.observed_at > rcv + max_future and event.provenance in OBSERVED_STATE_PROVENANCES:
            self.counter_rejected.inc(reason=RejectReason.FUTURE_TIMESTAMP.value)
            return IngestionRecord(
                event_id=event.event_id,
                channel_id=event.channel_id,
                station_id=event.station_id,
                observed_at=event.observed_at,
                received_at=rcv,
                outcome=IngestOutcome.REJECTED,
                ordering=Ordering.IN_ORDER,
                timeliness=Timeliness.ON_TIME,
                reason=RejectReason.FUTURE_TIMESTAMP,
                detail=f"observed_at {event.observed_at.isoformat()} is too far in future vs received {rcv.isoformat()}",
            )

        max_lateness = timedelta(seconds=self.settings.ingest_max_lateness_seconds)
        if rcv - event.observed_at > max_lateness:
            self.counter_rejected.inc(reason=RejectReason.TOO_LATE.value)
            return IngestionRecord(
                event_id=event.event_id,
                channel_id=event.channel_id,
                station_id=event.station_id,
                observed_at=event.observed_at,
                received_at=rcv,
                outcome=IngestOutcome.REJECTED,
                ordering=Ordering.OUT_OF_ORDER,
                timeliness=Timeliness.DELAYED,
                reason=RejectReason.TOO_LATE,
                detail=f"Reading exceeds maximum lateness retention window of {max_lateness}",
            )

        # 3. Deduplication & Conflict Detection
        nat_key = event.natural_key
        existing_val = self._recent_keys.get(nat_key)
        if event.event_id in self._recent_event_ids or existing_val is not None:
            # Check if identical value or conflicting value
            val_matches = (existing_val == event.value) or (existing_val is None and event.value is None)
            if val_matches:
                self.counter_duplicates.inc(station=event.station_id, channel=event.channel_id)
                return IngestionRecord(
                    event_id=event.event_id,
                    channel_id=event.channel_id,
                    station_id=event.station_id,
                    observed_at=event.observed_at,
                    received_at=rcv,
                    outcome=IngestOutcome.DUPLICATE,
                    ordering=Ordering.IN_ORDER,
                    timeliness=Timeliness.ON_TIME,
                    detail="Duplicate reading with identical natural key and value already ingested",
                )
            else:
                self.counter_conflicts.inc(station=event.station_id, channel=event.channel_id)
                logger.warning(
                    "Telemetry conflict detected",
                    extra={
                        "channel_id": event.channel_id,
                        "observed_at": event.observed_at.isoformat(),
                        "existing_value": existing_val,
                        "new_value": event.value,
                    },
                )
                return IngestionRecord(
                    event_id=event.event_id,
                    channel_id=event.channel_id,
                    station_id=event.station_id,
                    observed_at=event.observed_at,
                    received_at=rcv,
                    outcome=IngestOutcome.CONFLICT,
                    ordering=Ordering.IN_ORDER,
                    timeliness=Timeliness.ON_TIME,
                    detail=f"Conflict: natural key matches existing sample with different value ({existing_val} != {event.value})",
                )

        # Also check DB for historical natural key if not in recent cache
        db_match = self.session.execute(
            select(TelemetryReading.value).where(
                TelemetryReading.channel_id == event.channel_id,
                TelemetryReading.observed_at == event.observed_at,
                TelemetryReading.provenance == event.provenance,
                TelemetryReading.source == event.source,
            ).limit(1)
        ).scalar_one_or_none()
        if db_match is not None or (db_match is None and self.session.execute(
            select(TelemetryReading.id).where(
                TelemetryReading.channel_id == event.channel_id,
                TelemetryReading.observed_at == event.observed_at,
                TelemetryReading.provenance == event.provenance,
                TelemetryReading.source == event.source,
            ).limit(1)
        ).scalar_one_or_none() is not None):
            val_matches = (db_match == event.value) or (db_match is None and event.value is None)
            if val_matches:
                self.counter_duplicates.inc(station=event.station_id, channel=event.channel_id)
                self._recent_keys[nat_key] = event.value
                return IngestionRecord(
                    event_id=event.event_id,
                    channel_id=event.channel_id,
                    station_id=event.station_id,
                    observed_at=event.observed_at,
                    received_at=rcv,
                    outcome=IngestOutcome.DUPLICATE,
                    ordering=Ordering.IN_ORDER,
                    timeliness=Timeliness.ON_TIME,
                    detail="Duplicate reading present in database storage",
                )
            else:
                self.counter_conflicts.inc(station=event.station_id, channel=event.channel_id)
                return IngestionRecord(
                    event_id=event.event_id,
                    channel_id=event.channel_id,
                    station_id=event.station_id,
                    observed_at=event.observed_at,
                    received_at=rcv,
                    outcome=IngestOutcome.CONFLICT,
                    ordering=Ordering.IN_ORDER,
                    timeliness=Timeliness.ON_TIME,
                    detail=f"Conflict with stored historical value ({db_match} != {event.value})",
                )

        # 4. Ordering & Timeliness classification
        wm = self.watermarks.setdefault(event.channel_id, ChannelWatermark(channel_id=event.channel_id))
        flags: list[str] = []

        is_out_of_order = wm.latest_observed_at is not None and event.observed_at < wm.latest_observed_at
        ordering = Ordering.OUT_OF_ORDER if is_out_of_order else Ordering.IN_ORDER
        if is_out_of_order:
            flags.append("OUT_OF_ORDER")
            self.counter_out_of_order.inc(channel=event.channel_id)

        is_delayed = (rcv - event.observed_at).total_seconds() > self.settings.ingest_delayed_after_seconds
        timeliness = Timeliness.DELAYED if is_delayed else Timeliness.ON_TIME
        if is_delayed:
            flags.append("DELAYED")
            self.counter_delayed.inc(channel=event.channel_id)

        # 5. Gap detection via sequence_num if supplied
        if event.sequence_num is not None and wm.last_sequence_num is not None:
            expected_seq = wm.last_sequence_num + 1
            if event.sequence_num > expected_seq:
                flags.append("GAP_DETECTED")
                # Record gap operational event
                gap_size = event.sequence_num - expected_seq
                logger.info(f"Telemetry sequence gap detected on {event.channel_id}: missed {gap_size} samples")

        # Update cache & watermarks
        self._recent_keys[nat_key] = event.value
        self._recent_event_ids.add(event.event_id)
        if len(self._recent_keys) > 10000:
            # Pop oldest entries to keep memory bounded
            for k in list(self._recent_keys.keys())[:2000]:
                self._recent_keys.pop(k, None)
        if len(self._recent_event_ids) > 10000:
            self._recent_event_ids.clear()

        if ordering == Ordering.IN_ORDER:
            wm.latest_observed_at = event.observed_at
            wm.latest_value = event.value
            wm.latest_quality = event.quality
        if event.sequence_num is not None:
            wm.last_sequence_num = max(wm.last_sequence_num or 0, event.sequence_num)

        # 6. Insert TelemetryReading model
        reading = TelemetryReading(
            channel_id=event.channel_id,
            station_id=event.station_id,
            asset_id=event.asset_id,
            metric=event.metric,
            observed_at=event.observed_at,
            ingested_at=rcv,
            value=event.value,
            unit=event.unit,
            provenance=event.provenance,
            quality=event.quality,
            source=event.source,
            event_id=event.event_id,
            ingest_flags=",".join(flags) if flags else None,
        )
        self.session.add(reading)
        self.counter_accepted.inc(station=event.station_id)

        return IngestionRecord(
            event_id=event.event_id,
            channel_id=event.channel_id,
            station_id=event.station_id,
            observed_at=event.observed_at,
            received_at=rcv,
            outcome=IngestOutcome.ACCEPTED,
            ordering=ordering,
            timeliness=timeliness,
            flags=flags,
        )

    def process_batch(self, events: Sequence[TelemetryEvent], received_at: datetime | None = None) -> IngestionBatchResult:
        """Batch ingestion with atomic transaction commit."""
        rcv = ensure_utc(received_at) if received_at else utcnow()
        records: list[IngestionRecord] = []
        n_accepted = 0
        n_duplicates = 0
        n_conflicts = 0
        n_rejected = 0
        n_ooo = 0
        n_delayed = 0

        for event in events:
            rec = self.process_one(event, received_at=rcv)
            records.append(rec)
            if rec.outcome == IngestOutcome.ACCEPTED:
                n_accepted += 1
            elif rec.outcome == IngestOutcome.DUPLICATE:
                n_duplicates += 1
            elif rec.outcome == IngestOutcome.CONFLICT:
                n_conflicts += 1
            elif rec.outcome == IngestOutcome.REJECTED:
                n_rejected += 1

            if rec.ordering == Ordering.OUT_OF_ORDER:
                n_ooo += 1
            if rec.timeliness == Timeliness.DELAYED:
                n_delayed += 1

        self.session.flush()
        return IngestionBatchResult(
            received=len(events),
            accepted=n_accepted,
            duplicates=n_duplicates,
            conflicts=n_conflicts,
            rejected=n_rejected,
            out_of_order=n_ooo,
            delayed=n_delayed,
            records=records,
        )
