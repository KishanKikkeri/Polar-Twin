from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import create_app


def test_health_ok(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "ok"
    assert body["version"]
    assert body["time"].endswith("Z") or "+" in body["time"]


def test_health_degraded_when_db_unreachable():
    app = create_app()

    def broken_db():
        session = MagicMock()
        session.execute.side_effect = ConnectionError("db down")
        yield session

    app.dependency_overrides[get_db] = broken_db
    r = TestClient(app).get("/health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["database"] == {"status": "unavailable", "detail": "ConnectionError"}


def test_openapi_documents_all_endpoints(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    for p in [
        "/health",
        "/api/v1/stations",
        "/api/v1/stations/{station_id}",
        "/api/v1/stations/{station_id}/overview",
        "/api/v1/stations/{station_id}/assets",
        "/api/v1/stations/{station_id}/telemetry",
    ]:
        assert p in paths, p
    # 404 responses are documented with the error envelope.
    assert "404" in paths["/api/v1/stations/{station_id}"]["get"]["responses"]
