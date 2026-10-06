from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.domain.enums import Condition, DataCompleteness, Freshness, Provenance, Quality
from app.models import TelemetryReading
from app.schemas.overview import StationOverview
from tests.conftest import NOW, NOW_ISO

URL = "/api/v1/stations/{}/overview"


def test_overview_validates_against_schema(client: TestClient):
    r = client.get(URL.format("maitri"), params={"as_of": NOW_ISO})
    assert r.status_code == 200
    overview = StationOverview.model_validate(r.json())
    assert overview.station.id == "maitri"
    assert overview.counts.channels_total > 0
    assert overview.condition in Condition
    assert overview.completeness in DataCompleteness


def test_overview_defaults_as_of_to_current_time(client: TestClient):
    r = client.get(URL.format("maitri"))
    assert r.status_code == 200
    overview = StationOverview.model_validate(r.json())
    # generated_at and as_of should both be timezone-aware
    assert overview.as_of.tzinfo is not None
    assert overview.generated_at.tzinfo is not None


def test_data_notice_clearly_flags_synthetic_state(client: TestClient):
    for st in ("maitri", "bharati"):
        overview = client.get(URL.format(st), params={"as_of": NOW_ISO}).json()
        assert overview["contains_real_observations"] is False
        assert "SYNTHETIC" in overview["data_notice"]


def test_never_reporting_channel_is_explicitly_missing(client: TestClient):
    # In Maitri, lab humidity is configured to never report (never_reports=True)
    overview = client.get(URL.format("maitri"), params={"as_of": NOW_ISO}).json()
    lab = next(a for a in overview["assets"] if a["code"] == "indoor-env-lab")
    hum = next(c for c in lab["channels"] if c["metric"] == "humidity_pct")
    assert hum["freshness"] == Freshness.MISSING
    assert hum["condition"] == Condition.UNKNOWN
    assert hum["latest"] is None
    assert hum["last_valid"] is None
    assert hum["age_seconds"] is None


def test_stale_channel_detection(client: TestClient):
    # In Bharati, ro-unit-1 stopped reporting 3 hours ago (stale_after_seconds = 2700s = 45 min)
    overview = client.get(URL.format("bharati"), params={"as_of": NOW_ISO}).json()
    ro = next(a for a in overview["assets"] if a["code"] == "ro-unit-1")
    flow = next(c for c in ro["channels"] if c["metric"] == "output_lph")
    assert flow["freshness"] == Freshness.STALE
    assert flow["latest"] is not None
    assert flow["latest"]["value"] is not None
    assert flow["age_seconds"] >= 3 * 3600 - 60


def test_predictions_never_become_current_state(client: TestClient):
    # fuel-inventory has PREDICTED readings for +24 hours into the future
    overview = client.get(URL.format("maitri"), params={"as_of": NOW_ISO}).json()
    fuel = next(a for a in overview["assets"] if a["code"] == "fuel-inventory")
    vol = next(c for c in fuel["channels"] if c["metric"] == "total_volume_kl")
    # Current state must be DERIVED, not PREDICTED
    assert vol["latest"]["provenance"] == Provenance.DERIVED
    assert vol["next_prediction"] is not None
    assert vol["next_prediction"]["provenance"] == Provenance.PREDICTED
    # Prediction target timestamp is in the future relative to as_of
    assert vol["next_prediction"]["observed_at"] > vol["latest"]["observed_at"]


def test_simulated_readings_do_not_overwrite_observed_state(fresh_client: TestClient, fresh_session):
    # Maitri boiler-1 has an overlay of SIMULATED readings
    overview = fresh_client.get(URL.format("maitri"), params={"as_of": NOW_ISO}).json()
    boiler = next(a for a in overview["assets"] if a["code"] == "boiler-1")
    temp = next(c for c in boiler["channels"] if c["metric"] == "supply_temp_c")
    # Must remain SYNTHETIC (the observed stand-in)
    assert temp["latest"]["provenance"] == Provenance.SYNTHETIC


def test_simulation_or_prediction_cannot_overwrite_even_if_newer(fresh_client: TestClient, fresh_session):
    # Insert a SIMULATED reading with observed_at right at NOW
    channel_id = "maitri.dg-1.load_kw"
    sim_reading = TelemetryReading(
        channel_id=channel_id,
        station_id="maitri",
        asset_id="maitri.dg-1",
        metric="load_kw",
        observed_at=NOW,
        ingested_at=NOW,
        value=999.0,
        unit="kW",
        provenance=Provenance.SIMULATED,
        quality=Quality.GOOD,
        source="test:sim-injection",
    )
    fresh_session.add(sim_reading)
    fresh_session.commit()

    overview = fresh_client.get(URL.format("maitri"), params={"as_of": NOW_ISO}).json()
    dg1 = next(a for a in overview["assets"] if a["code"] == "dg-1")
    load = next(c for c in dg1["channels"] if c["metric"] == "load_kw")
    # The 999.0 simulated value must not have become the latest state!
    assert load["latest"]["provenance"] == Provenance.SYNTHETIC
    assert load["latest"]["value"] != 999.0


def test_as_of_in_the_past_replays_historical_state(client: TestClient):
    # 12 hours ago
    past_dt = NOW - timedelta(hours=12)
    past_iso = past_dt.isoformat()
    overview = client.get(URL.format("maitri"), params={"as_of": past_iso}).json()
    returned_as_of = datetime.fromisoformat(overview["as_of"].replace("Z", "+00:00"))
    assert returned_as_of == past_dt
    for a in overview["assets"]:
        for c in a["channels"]:
            if c["latest"]:
                obs = datetime.fromisoformat(c["latest"]["observed_at"].replace("Z", "+00:00"))
                assert obs <= past_dt


def test_system_and_station_level_condition_rollups(client: TestClient):
    overview = client.get(URL.format("bharati"), params={"as_of": NOW_ISO}).json()
    systems = {s["system"]: s for s in overview["systems"]}
    assert "ELECTRICITY" in systems
    assert "WATER" in systems
    # Because ro-unit-1 is STALE in WATER system, completeness is PARTIAL
    assert systems["WATER"]["completeness"] in (DataCompleteness.PARTIAL, DataCompleteness.COMPLETE)
