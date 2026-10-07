"""Tests for Security: RBAC model enforcement, tokens, and cryptographic audit hash chaining."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domain.runtime_enums import AuditOutcome, Permission, Role
from app.runtime.security import (
    AuthenticatedUser,
    AuditLogger,
    create_token,
    verify_token,
)


def test_token_creation_and_verification():
    token = create_token(
        user_id="operator-1",
        roles=[Role.STATION_OPERATOR],
        station_ids=["maitri"],
    )
    user = verify_token(token)
    assert user.user_id == "operator-1"
    assert Role.STATION_OPERATOR in user.roles
    assert "maitri" in user.station_ids

    # Check station boundary permissions
    assert user.has_permission(Permission.ALERTS_ACKNOWLEDGE, station_id="maitri") is True
    assert user.has_permission(Permission.ALERTS_ACKNOWLEDGE, station_id="bharati") is False
    assert user.has_permission(Permission.RUNTIME_CONTROL) is False


def test_audit_hash_chaining_integrity_and_tamper_detection(fresh_session: Session):
    logger_tool = AuditLogger(fresh_session)

    # 1. Log three events
    ev1 = logger_tool.log(actor="admin", action="RUNTIME_START", resource_type="runtime")
    ev2 = logger_tool.log(actor="operator", action="ALERT_ACK", resource_type="alert", resource_id="alt-1")
    ev3 = logger_tool.log(actor="hq", action="WHAT_IF_RUN", resource_type="scenario")

    assert ev1.prev_hash == "0" * 64
    assert ev2.prev_hash == ev1.hash
    assert ev3.prev_hash == ev2.hash

    # Chain verification should succeed
    assert logger_tool.verify_chain() is True

    # 2. Tamper with an event in the chain (e.g. malicious actor edits ev2 action)
    ev2.action = "TAMPERED_ACTION"
    fresh_session.flush()

    # Chain verification must now detect tampering and fail!
    assert logger_tool.verify_chain() is False


def test_rbac_api_endpoint_protection(fresh_client: TestClient):
    # Public read of status allowed
    r_status = fresh_client.get("/api/v1/runtime/status")
    assert r_status.status_code == 200

    # Unauthenticated attempt to step runtime (requires RUNTIME_CONTROL) -> 403 Forbidden
    r_step_anon = fresh_client.post("/api/v1/runtime/step")
    assert r_step_anon.status_code == 403

    # Authenticate as VIEWER
    viewer_token = create_token("viewer-user", roles=[Role.VIEWER])
    headers_viewer = {"Authorization": f"Bearer {viewer_token}"}
    r_step_viewer = fresh_client.post("/api/v1/runtime/step", headers=headers_viewer)
    assert r_step_viewer.status_code == 403

    # Authenticate as SYSTEM_ADMIN
    admin_token = create_token("admin-user", roles=[Role.SYSTEM_ADMIN])
    headers_admin = {"Authorization": f"Bearer {admin_token}"}
    r_step_admin = fresh_client.post("/api/v1/runtime/step", headers=headers_admin)
    assert r_step_admin.status_code == 200
