from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.schemas.telemetry import TelemetryReadingSchema
from tests.conftest import NOW

URL = "/api/v1/stations/{}/telemetry"


def test_telemetry_returns_raw_readings_with_provenance_and_quality(client: TestClient):
    r = client.get(URL.format("maitri"), params={"limit": 50})
    assert r.status_code == 200
    items = [TelemetryReadingSchema.model_validate(x) for x in r.json()]
    assert len(items) == 50
    for item in items:
        assert item.provenance is not None and item.quality is not None
        assert item.observed_at.tzinfo is not None and item.ingested_at.tzinfo is not None
        assert item.source.startswith("seed:")
        # Frontend aliases
        assert item.telemetry_id == str(item.id)
        assert item.parameter == item.metric
        assert item.timestamp is not None
        assert item.source_type == item.provenance


def test_timestamps_are_iso8601_with_timezone(client: TestClient):
    item = client.get(URL.format("maitri"), params={"limit": 1}).json()[0]
    for field in ("observed_at", "ingested_at"):
        parsed = datetime.fromisoformat(item[field].replace("Z", "+00:00"))
        assert parsed.utcoffset() == timedelta(0)


def test_default_order_is_newest_first_and_asc_works(client: TestClient):
    desc = client.get(URL.format("maitri"), params={"asset_id": "maitri.dg-1", "limit": 5}).json()
    asc = client.get(URL.format("maitri"), params={"asset_id": "maitri.dg-1", "limit": 5, "order": "asc"}).json()
    assert [i["observed_at"] for i in desc] == sorted([i["observed_at"] for i in desc], reverse=True)
    assert [i["observed_at"] for i in asc] == sorted([i["observed_at"] for i in asc])
    assert desc[0]["observed_at"] > asc[0]["observed_at"]


def test_filter_by_asset_and_metric(client: TestClient):
    items = client.get(URL.format("maitri"), params={"asset_id": "maitri.power-bus", "metric": "voltage_v"}).json()
    assert len(items) == 96  # 24h at 15-min cadence
    assert {i["metric"] for i in items} == {"voltage_v"}
    assert {i["unit"] for i in items} == {"V"}


def test_filter_by_range_and_parameter(client: TestClient):
    items = client.get(URL.format("maitri"), params={"range": "1h", "parameter": "air_temp_c"}).json()
    assert len(items) > 0
    assert {i["metric"] for i in items} == {"air_temp_c"}


def test_missing_samples_are_null_never_zero(client: TestClient):
    items = client.get(
        URL.format("maitri"), params={"asset_id": "maitri.satcom-1", "quality": "MISSING", "limit": 5000}
    ).json()
    assert len(items) > 0
    for item in items:
        assert item["value"] is None
        assert item["quality"] == "MISSING"


def test_provenance_filter_is_repeatable(client: TestClient):
    items = client.get(
        URL.format("maitri"), params=[("provenance", "PREDICTED"), ("provenance", "SIMULATED"), ("limit", "5000")]
    ).json()
    assert len(items) > 0
    assert {i["provenance"] for i in items} == {"PREDICTED", "SIMULATED"}


def test_time_window_filter(client: TestClient):
    start = (NOW - timedelta(hours=1)).isoformat()
    end = NOW.isoformat()
    items = client.get(
        URL.format("bharati"), params={"asset_id": "bharati.chp-1", "start": start, "end": end}
    ).json()
    assert len(items) == 5  # inclusive: :00, :15, :30, :45, :00
    for i in items:
        ts = datetime.fromisoformat(i["observed_at"].replace("Z", "+00:00"))
        assert NOW - timedelta(hours=1) <= ts <= NOW


def test_naive_timestamp_rejected(client: TestClient):
    r = client.get(URL.format("maitri"), params={"start": "2026-10-06T10:00:00"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_start_after_end_rejected(client: TestClient):
    r = client.get(
        URL.format("maitri"), params={"start": "2026-10-06T12:00:00Z", "end": "2026-10-06T10:00:00Z"}
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 5001}, {"offset": -1}, {"order": "sideways"},
                                    {"provenance": "GUESSED"}, {"quality": "OK"}])
def test_invalid_query_params_rejected(client: TestClient, params: dict):
    r = client.get(URL.format("maitri"), params=params)
    assert r.status_code == 422, params
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_asset_404(client: TestClient):
    r = client.get(URL.format("maitri"), params={"asset_id": "maitri.warp-core"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ASSET_NOT_FOUND"


def test_asset_from_other_station_404(client: TestClient):
    r = client.get(URL.format("maitri"), params={"asset_id": "bharati.chp-1"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ASSET_NOT_FOUND"


def test_pagination(client: TestClient):
    p1 = client.get(URL.format("bharati"), params={"limit": 10, "offset": 0}).json()
    p2 = client.get(URL.format("bharati"), params={"limit": 10, "offset": 10}).json()
    assert len(p1) == 10 and len(p2) == 10
    assert not {i["id"] for i in p1} & {i["id"] for i in p2}
