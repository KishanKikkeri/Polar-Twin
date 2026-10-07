"""Tests for Ingestion Pipeline validation, deduplication, conflicts, out-of-order, and delays."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Provenance, Quality
from app.domain.runtime_enums import IngestOutcome, Ordering, RejectReason, Timeliness
from app.models.telemetry import TelemetryReading
from app.runtime.ingestion import IngestionPipeline
from app.runtime.telemetry_event import TelemetryEvent


def test_ingestion_validation_and_acceptance(fresh_session: Session):
    pipeline = IngestionPipeline(session=fresh_session)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    event = TelemetryEvent(
        event_id="ev-valid-1",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-15.4,
        provenance=Provenance.SYNTHETIC,
        quality=Quality.GOOD,
        source="test:sensor:1",
    )

    rec = pipeline.process_one(event, received_at=now)
    assert rec.outcome == IngestOutcome.ACCEPTED
    assert rec.ordering == Ordering.IN_ORDER
    assert rec.timeliness == Timeliness.ON_TIME

    # Check persisted reading
    row = fresh_session.execute(
        select(TelemetryReading).where(TelemetryReading.event_id == "ev-valid-1")
    ).scalar_one()
    assert row.value == -15.4
    assert row.channel_id == "maitri.aws-1.air_temp_c"


def test_ingestion_rejects_unknown_channel(fresh_session: Session):
    pipeline = IngestionPipeline(session=fresh_session)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    event = TelemetryEvent(
        event_id="ev-bad-ch",
        station_id="maitri",
        asset_id="maitri.fictional-asset",
        channel_id="maitri.fictional-asset.magic_metric",
        metric="magic_metric",
        unit="V",
        observed_at=now,
        value=100.0,
    )
    rec = pipeline.process_one(event, received_at=now)
    assert rec.outcome == IngestOutcome.REJECTED
    assert rec.reason == RejectReason.UNKNOWN_CHANNEL


def test_ingestion_duplicate_detection(fresh_session: Session):
    pipeline = IngestionPipeline(session=fresh_session)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    event = TelemetryEvent(
        event_id="ev-dup-1",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-12.0,
        provenance=Provenance.SYNTHETIC,
        quality=Quality.GOOD,
        source="test:sensor:1",
    )

    rec1 = pipeline.process_one(event, received_at=now)
    assert rec1.outcome == IngestOutcome.ACCEPTED

    # Ingest identical event again
    rec2 = pipeline.process_one(event, received_at=now)
    assert rec2.outcome == IngestOutcome.DUPLICATE

    # Ensure only 1 row was stored
    count = fresh_session.query(TelemetryReading).filter_by(event_id="ev-dup-1").count()
    assert count == 1


def test_ingestion_conflict_detection_never_overwrites(fresh_session: Session):
    pipeline = IngestionPipeline(session=fresh_session)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    event1 = TelemetryEvent(
        event_id="ev-conf-1",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-10.0,
        provenance=Provenance.SYNTHETIC,
        quality=Quality.GOOD,
        source="test:source:A",
    )
    pipeline.process_one(event1, received_at=now)

    # Different value for exact same natural key
    event2 = TelemetryEvent(
        event_id="ev-conf-2",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-25.0,  # CONFLICT!
        provenance=Provenance.SYNTHETIC,
        quality=Quality.GOOD,
        source="test:source:A",
    )
    rec2 = pipeline.process_one(event2, received_at=now)
    assert rec2.outcome == IngestOutcome.CONFLICT

    # Value in database remains the original -20.0
    val = fresh_session.execute(
        select(TelemetryReading.value).where(
            TelemetryReading.channel_id == "maitri.aws-1.air_temp_c",
            TelemetryReading.observed_at == now,
        )
    ).scalar_one()
    assert val == -10.0


def test_ingestion_out_of_order_and_delayed(fresh_session: Session):
    pipeline = IngestionPipeline(session=fresh_session)
    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    t_newer = t0 + timedelta(minutes=15)
    t_older = t0 + timedelta(minutes=5)

    # Ingest newer reading first
    pipeline.process_one(
        TelemetryEvent(
            event_id="ev-seq-2",
            station_id="maitri",
            asset_id="maitri.aws-1",
            channel_id="maitri.aws-1.air_temp_c",
            metric="air_temp_c",
            unit="degC",
            observed_at=t_newer,
            value=-15.0,
        ),
        received_at=t_newer,
    )

    # Ingest older reading later (delayed by 2 hours)
    recv_delayed = t_newer + timedelta(hours=2)
    rec_ooo = pipeline.process_one(
        TelemetryEvent(
            event_id="ev-seq-1",
            station_id="maitri",
            asset_id="maitri.aws-1",
            channel_id="maitri.aws-1.air_temp_c",
            metric="air_temp_c",
            unit="degC",
            observed_at=t_older,
            value=-16.2,
        ),
        received_at=recv_delayed,
    )

    assert rec_ooo.outcome == IngestOutcome.ACCEPTED
    assert rec_ooo.ordering == Ordering.OUT_OF_ORDER
    assert rec_ooo.timeliness == Timeliness.DELAYED
    assert "OUT_OF_ORDER" in rec_ooo.flags
    assert "DELAYED" in rec_ooo.flags

    # Watermark did NOT regress backwards to t_older!
    wm = pipeline.watermarks["maitri.aws-1.air_temp_c"]
    assert wm.latest_observed_at == t_newer
