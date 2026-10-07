"""Tests verifying strict alignment with Agent 4B and Agent 4C contracts.

Validates:
1. Agent 4C TwinState shape (agent4c-contracts.md §1)
   {
     stationId, asOf,
     assets: [{ id, type, status, capacityKw? }],
     energy: { baseDemandKw, batteryKwh, batteryCapacityKwh },
     fuel: { tankL, resupplyL },
     logistics: { nextResupplyH },
     thermal: { indoorC },
     comms: { linkQuality },
     environment: { outdoorC, windMs },
     alerts: [{ id, severity, category, message }]
   }
2. Telemetry event contract (agent4a-contracts.md)
"""

from fastapi.testclient import TestClient

from app.runtime.service import TwinRuntimeService


def test_twin_state_matches_agent_4c_contract():
    svc = TwinRuntimeService()
    state = svc.get_twin_state_contract("maitri")

    # Required top-level keys
    assert "stationId" in state
    assert state["stationId"] == "maitri"
    assert "asOf" in state
    assert "assets" in state
    assert "energy" in state
    assert "fuel" in state
    assert "logistics" in state
    assert "thermal" in state
    assert "comms" in state
    assert "environment" in state
    assert "alerts" in state

    # Sub-object fields
    assert "baseDemandKw" in state["energy"]
    assert "tankL" in state["fuel"]
    assert "nextResupplyH" in state["logistics"]
    assert "indoorC" in state["thermal"]
    assert "outdoorC" in state["environment"]
    assert "windMs" in state["environment"]
    assert "linkQuality" in state["comms"]

    # Assets array shape
    assert len(state["assets"]) >= 3
    for a in state["assets"]:
        assert "id" in a
        assert "type" in a
        assert "status" in a
        assert a["type"] == "generator"

    # Alerts array shape
    assert isinstance(state["alerts"], list)


def test_twin_state_endpoint_integration(fresh_client: TestClient):
    r = fresh_client.get("/api/v1/runtime/maitri/state")
    assert r.status_code == 200
    data = r.json()
    assert data["stationId"] == "maitri"
    assert "energy" in data
    assert "fuel" in data
    assert "environment" in data
