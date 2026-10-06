from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Asset, Building, Station, TelemetryChannel, TelemetryReading
from app.seed.seeder import seed


def test_seed_is_idempotent(empty_engine):
    with Session(empty_engine) as session:
        # First seed run
        res1 = seed(session, now=datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC))
        assert res1.topology["stations"] == 2
        assert "maitri" in res1.telemetry_inserted
        assert "bharati" in res1.telemetry_inserted

        # Second seed run without reset should skip telemetry insertion
        res2 = seed(session, now=datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC))
        assert res2.telemetry_inserted == {}
        assert "maitri" in res2.telemetry_skipped
        assert "bharati" in res2.telemetry_skipped

        # Counts should remain intact
        stations = session.query(Station).count()
        buildings = session.query(Building).count()
        assets = session.query(Asset).count()
        channels = session.query(TelemetryChannel).count()
        readings = session.query(TelemetryReading).count()

        assert stations == 2
        assert buildings == 27  # 15 Maitri + 12 Bharati
        assert assets > 0
        assert channels > 0
        assert readings > 0


def test_seed_reset_regenerates_telemetry(empty_engine):
    with Session(empty_engine) as session:
        seed(session, now=datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC))
        count1 = session.query(TelemetryReading).count()

        # Seed with reset
        res = seed(session, now=datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC), reset_telemetry=True)
        count2 = session.query(TelemetryReading).count()
        assert count1 == count2
        assert len(res.telemetry_inserted) == 2
