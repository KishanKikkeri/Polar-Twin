"""Tests for Alert lifecycle, escalation, acknowledgement, resolution, and event logging."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.runtime_enums import AlertSeverity, AlertState, EventType
from app.models.runtime import TwinAlert, TwinEvent
from app.runtime.alerts import AlertEngine
from app.runtime.causal_model import build_station_causal_graph


def test_alert_lifecycle_and_events(fresh_session: Session):
    graph = build_station_causal_graph("maitri")
    engine = AlertEngine(session=fresh_session)
    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    # 1. Normal state: no alerts triggered
    normal_obs = {
        "maitri.env.air_temp_c": -12.0,
        "maitri.env.wind_speed_ms": 6.0,
        "maitri.inventory.tank_a_pct": 80.0,
        "maitri.inventory.tank_b_pct": 80.0,
        "maitri.inventory.tank_c_pct": 80.0,
    }
    dep_normal = graph.evaluate(normal_obs)
    alerts = engine.evaluate("maitri", dep_normal, evaluated_at=t0)
    assert len(alerts) == 0

    # 2. Trigger low autonomy WARNING (<90 days, at 7% fill ~54 days autonomy)
    low_fuel_obs = dict(normal_obs)
    low_fuel_obs["maitri.inventory.tank_a_pct"] = 7.0
    low_fuel_obs["maitri.inventory.tank_b_pct"] = 7.0
    low_fuel_obs["maitri.inventory.tank_c_pct"] = 7.0

    dep_warn = graph.evaluate(low_fuel_obs)
    warn_alerts = engine.evaluate("maitri", dep_warn, evaluated_at=t0)
    assert len(warn_alerts) >= 1
    autonomy_alt = next(a for a in warn_alerts if "autonomy" in a.rule_id)
    assert autonomy_alt.state == AlertState.OPEN
    assert autonomy_alt.severity == AlertSeverity.WARNING

    # Verify ALERT_RAISED event was written
    raised_ev = fresh_session.scalars(
        select(TwinEvent).where(TwinEvent.event_type == EventType.ALERT_RAISED)
    ).first()
    assert raised_ev is not None
    assert raised_ev.alert_id == autonomy_alt.id

    # 3. Trigger CRITICAL escalation (<30 days, at 2% fill ~15 days autonomy)
    crit_fuel_obs = dict(normal_obs)
    crit_fuel_obs["maitri.inventory.tank_a_pct"] = 2.0
    crit_fuel_obs["maitri.inventory.tank_b_pct"] = 2.0
    crit_fuel_obs["maitri.inventory.tank_c_pct"] = 2.0

    dep_crit = graph.evaluate(crit_fuel_obs)
    crit_alerts = engine.evaluate("maitri", dep_crit, evaluated_at=t0)
    autonomy_alt_escalated = next(a for a in crit_alerts if "autonomy" in a.rule_id)
    assert autonomy_alt_escalated.severity == AlertSeverity.CRITICAL

    # Verify ALERT_ESCALATED event was written
    escalated_ev = fresh_session.scalars(
        select(TwinEvent).where(TwinEvent.event_type == EventType.ALERT_ESCALATED)
    ).first()
    assert escalated_ev is not None

    # 4. Operator acknowledges alert
    ack_alert = engine.acknowledge(
        alert_id=autonomy_alt.id,
        actor="operator:maitri_eng",
        note="Switching non-critical quarters to economy heating mode.",
    )
    assert ack_alert.state == AlertState.ACKNOWLEDGED
    assert ack_alert.acknowledged_by == "operator:maitri_eng"

    # Verify ALERT_ACKNOWLEDGED event was written
    ack_ev = fresh_session.scalars(
        select(TwinEvent).where(TwinEvent.event_type == EventType.ALERT_ACKNOWLEDGED)
    ).first()
    assert ack_ev is not None

    # 5. Condition clears (fuel resupply completed -> tanks back to 80%)
    dep_restored = graph.evaluate(normal_obs)
    cleared_alerts = engine.evaluate("maitri", dep_restored, evaluated_at=t0)
    resolved_alt = next(a for a in cleared_alerts if "autonomy" in a.rule_id)
    assert resolved_alt.state == AlertState.RESOLVED
    assert resolved_alt.resolved_at is not None

    # Verify ALERT_RESOLVED event was written
    resolved_ev = fresh_session.scalars(
        select(TwinEvent).where(TwinEvent.event_type == EventType.ALERT_RESOLVED)
    ).first()
    assert resolved_ev is not None
