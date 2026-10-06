from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.enums import Provenance, Quality
from app.models import TelemetryReading
from tests.conftest import NOW


def test_missing_quality_with_non_null_value_fails_check_constraint(fresh_session: Session):
    reading = TelemetryReading(
        channel_id="maitri.dg-1.load_kw",
        station_id="maitri",
        asset_id="maitri.dg-1",
        metric="load_kw",
        observed_at=NOW,
        ingested_at=NOW,
        value=50.0,  # INVALID: cannot have value with Quality.MISSING
        unit="kW",
        provenance=Provenance.SYNTHETIC,
        quality=Quality.MISSING,
        source="test:invalid",
    )
    fresh_session.add(reading)
    with pytest.raises(IntegrityError):
        fresh_session.commit()
    fresh_session.rollback()


def test_good_quality_with_null_value_fails_check_constraint(fresh_session: Session):
    reading = TelemetryReading(
        channel_id="maitri.dg-1.load_kw",
        station_id="maitri",
        asset_id="maitri.dg-1",
        metric="load_kw",
        observed_at=NOW,
        ingested_at=NOW,
        value=None,  # INVALID: cannot have null value with Quality.GOOD
        unit="kW",
        provenance=Provenance.SYNTHETIC,
        quality=Quality.GOOD,
        source="test:invalid",
    )
    fresh_session.add(reading)
    with pytest.raises(IntegrityError):
        fresh_session.commit()
    fresh_session.rollback()


def test_valid_missing_reading_succeeds(fresh_session: Session):
    reading = TelemetryReading(
        channel_id="maitri.dg-1.load_kw",
        station_id="maitri",
        asset_id="maitri.dg-1",
        metric="load_kw",
        observed_at=NOW,
        ingested_at=NOW,
        value=None,
        unit="kW",
        provenance=Provenance.SYNTHETIC,
        quality=Quality.MISSING,
        source="test:valid-gap",
    )
    fresh_session.add(reading)
    fresh_session.commit()
    assert reading.id is not None
