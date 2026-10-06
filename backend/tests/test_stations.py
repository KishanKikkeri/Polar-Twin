import pytest
from fastapi.testclient import TestClient

from app.schemas.station import AssetSchema, StationDetail, StationSummary


def test_list_stations_returns_both(client: TestClient):
    r = client.get("/api/v1/stations")
    assert r.status_code == 200
    items = [StationSummary.model_validate(s) for s in r.json()]
    assert len(items) == 2
    assert {s.id for s in items} == {"maitri", "bharati"}
    assert {s.station_id for s in items} == {"maitri", "bharati"}
    maitri = next(s for s in items if s.id == "maitri")
    assert maitri.coordinates.lat == pytest.approx(-70.7653)
    assert maitri.coordinates.lon == pytest.approx(11.7358)
    assert maitri.latitude == pytest.approx(-70.7653)
    assert maitri.longitude == pytest.approx(11.7358)


@pytest.mark.parametrize("station_id", ["maitri", "bharati"])
def test_station_detail(client: TestClient, station_id: str):
    r = client.get(f"/api/v1/stations/{station_id}")
    assert r.status_code == 200
    detail = StationDetail.model_validate(r.json())
    assert detail.id == station_id
    assert detail.station_id == station_id
    assert detail.station_name == detail.name
    assert detail.asset_count > 0 and detail.channel_count > 0
    codes = {b.code for b in detail.buildings}
    # Building codes match the frontend scene object ids.
    assert {"main-building", "power-house", "fuel-farm", "laboratory", "comms-tower"} <= codes
    for b in detail.buildings:
        assert b.id == f"{station_id}.{b.code}"
    assert detail.updated_at.tzinfo is not None


def test_maitri_power_house_lists_generators(client: TestClient):
    detail = client.get("/api/v1/stations/maitri").json()
    ph = next(b for b in detail["buildings"] if b["code"] == "power-house")
    assert {"maitri.dg-1", "maitri.dg-2", "maitri.dg-3", "maitri.power-bus"} <= set(ph["asset_ids"])


@pytest.mark.parametrize("suffix", ["", "/overview", "/assets", "/telemetry"])
def test_unknown_station_returns_404_envelope(client: TestClient, suffix: str):
    r = client.get(f"/api/v1/stations/vostok{suffix}")
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "STATION_NOT_FOUND"
    assert "vostok" in err["message"]
    assert err["details"]["known_station_ids"] == ["bharati", "maitri"]


def test_unknown_route_uses_error_envelope(client: TestClient):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_assets_have_channels(client: TestClient):
    r = client.get("/api/v1/stations/bharati/assets")
    assert r.status_code == 200
    items = [AssetSchema.model_validate(a) for a in r.json()]
    assert len(items) > 0
    for a in items:
        assert a.station_id == "bharati"
        assert a.id.startswith("bharati.")
        assert a.asset_id == a.id
        assert a.channels, a.id
        for c in a.channels:
            assert c.stale_after_seconds >= c.expected_interval_seconds
            assert c.unit


def test_assets_filter_by_system(client: TestClient):
    items = client.get("/api/v1/stations/maitri/assets", params={"system": "FUEL"}).json()
    assert len(items) == 4
    assert {a["system"] for a in items} == {"FUEL"}


def test_assets_filter_by_building(client: TestClient):
    items = client.get("/api/v1/stations/maitri/assets", params={"building_id": "maitri.fuel-farm"}).json()
    assert {a["code"] for a in items} == {"tank-a", "tank-b", "tank-c", "fuel-inventory"}
    # building_id on returned asset matches frontend 3D object code
    assert all(a["building_id"] == "fuel-farm" for a in items)


def test_assets_invalid_system_is_422(client: TestClient):
    r = client.get("/api/v1/stations/maitri/assets", params={"system": "PLUMBING"})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert err["details"][0]["loc"] == ["query", "system"]
