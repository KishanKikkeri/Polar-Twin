"""Tests for TimescaleDB capability detection and DDL builder compatibility."""

from sqlalchemy import create_engine
from app.db import timescale


def test_timescaledb_detection_on_sqlite():
    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        status = timescale.detect(conn)
        assert status.dialect == "sqlite"
        assert status.available is False
        assert status.installed_version is None
        assert status.hypertable is False


def test_timescaledb_ddl_statement_generation():
    hyper_ddl = timescale.hypertable_statements()
    assert len(hyper_ddl) >= 4
    assert any("create_hypertable" in stmt for stmt in hyper_ddl)
    assert any("PRIMARY KEY (id, observed_at)" in stmt for stmt in hyper_ddl)

    compress_ddl = timescale.compression_statements()
    assert any("compress_segmentby" in stmt for stmt in compress_ddl)

    cagg_ddl = timescale.continuous_aggregate_statements()
    assert any("telemetry_hourly" in stmt for stmt in cagg_ddl)
