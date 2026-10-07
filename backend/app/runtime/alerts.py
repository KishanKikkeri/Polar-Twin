"""Alert & Event Engine: evaluation, lifecycle management, and event logging.

Alert Lifecycle:
    [Condition Triggered]
            ↓
          OPEN  ──(Operator Acknowledges)──>  ACKNOWLEDGED
            │                                      │
            └──────────(Condition Clears)──────────┘
                            ↓
                        RESOLVED
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.timeutil import utcnow
from app.domain.runtime_enums import (
    ACTIVE_ALERT_STATES,
    AlertSeverity,
    AlertSource,
    AlertState,
    EventType,
    TwinDomain,
)
from app.models.runtime import TwinAlert, TwinEvent
from app.runtime.dependency import DependencyEvaluation

logger = get_logger("polartwin.alerts")


@dataclass
class RuleEvaluationResult:
    triggered: bool
    severity: AlertSeverity
    title: str
    message: str
    recommended_action: str
    node_id: str | None = None
    asset_id: str | None = None
    channel_id: str | None = None
    value: float | None = None
    threshold: float | None = None
    unit: str | None = None
    domain: TwinDomain | None = None
    evidence: dict[str, Any] | None = None


RuleEvaluator = Callable[[str, DependencyEvaluation], RuleEvaluationResult | None]


@dataclass
class AlertRule:
    rule_id: str
    source: AlertSource
    evaluator: RuleEvaluator


def build_default_rules() -> list[AlertRule]:
    """Default polar station operational and dependency rules."""

    # 1. Autonomy warning (<90 days) and critical (<30 days)
    def _eval_autonomy(station_id: str, dep: DependencyEvaluation) -> RuleEvaluationResult | None:
        autonomy = dep.value(f"{station_id}.logistics.days_of_autonomy")
        if autonomy is None:
            return None
        if autonomy < 30.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.CRITICAL,
                title="Critical Fuel Autonomy Deficit",
                message=f"Fuel autonomy has fallen to {autonomy:.1f} days (below 30-day emergency reserve threshold).",
                recommended_action="Initiate immediate emergency fuel conservation mode and prioritize resupply tanker dispatch.",
                node_id=f"{station_id}.logistics.days_of_autonomy",
                domain=TwinDomain.LOGISTICS,
                value=autonomy,
                threshold=30.0,
                unit="days",
            )
        elif autonomy < 90.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.WARNING,
                title="Low Fuel Autonomy Warning",
                message=f"Fuel autonomy is {autonomy:.1f} days (below 90-day seasonal buffer).",
                recommended_action="Review diesel generator dispatch and optimize building heating loops to conserve bulk fuel.",
                node_id=f"{station_id}.logistics.days_of_autonomy",
                domain=TwinDomain.LOGISTICS,
                value=autonomy,
                threshold=90.0,
                unit="days",
            )
        return None

    # 2. Generation N-1 redundancy reserve (<15% critical, <25% warning)
    def _eval_n_minus_one(station_id: str, dep: DependencyEvaluation) -> RuleEvaluationResult | None:
        margin = dep.value(f"{station_id}.risk.n_minus_1_margin_pct")
        if margin is None:
            return None
        if margin < 15.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.CRITICAL,
                title="N-1 Generation Capacity Depleted",
                message=f"N-1 redundancy margin is {margin:.1f}%. A trip of the primary generator will cause immediate blackout.",
                recommended_action="Start standby diesel generator immediately and shed non-vital lab loads.",
                node_id=f"{station_id}.risk.n_minus_1_margin_pct",
                domain=TwinDomain.RISK,
                value=margin,
                threshold=15.0,
                unit="%",
            )
        elif margin < 25.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.WARNING,
                title="N-1 Generation Redundancy Constrained",
                message=f"N-1 redundancy margin is {margin:.1f}%. Generation reserves are tight.",
                recommended_action="Prepare auxiliary generator for synchronization if station load rises further.",
                node_id=f"{station_id}.risk.n_minus_1_margin_pct",
                domain=TwinDomain.RISK,
                value=margin,
                threshold=25.0,
                unit="%",
            )
        return None

    # 3. Heating Plant Overload (>95% critical, >85% warning)
    def _eval_boiler_load(station_id: str, dep: DependencyEvaluation) -> RuleEvaluationResult | None:
        boiler_load = dep.value(f"{station_id}.heating.boiler_load_pct")
        if boiler_load is None:
            return None
        if boiler_load >= 95.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.CRITICAL,
                title="Heating Plant Near Maximum Thermal Capacity",
                message=f"Heating plant firing rate is {boiler_load:.1f}% due to severe external blizzard conditions.",
                recommended_action="Inspect hydronic distribution loops; isolate unpopulated accommodation zones if necessary.",
                node_id=f"{station_id}.heating.boiler_load_pct",
                domain=TwinDomain.HEATING,
                value=boiler_load,
                threshold=95.0,
                unit="%",
            )
        elif boiler_load >= 85.0:
            return RuleEvaluationResult(
                triggered=True,
                severity=AlertSeverity.WARNING,
                title="Elevated Heating Plant Demand",
                message=f"Heating load is {boiler_load:.1f}%. Thermal demand is high.",
                recommended_action="Monitor heating loop supply temperature and ensure secondary heat exchangers are online.",
                node_id=f"{station_id}.heating.boiler_load_pct",
                domain=TwinDomain.HEATING,
                value=boiler_load,
                threshold=85.0,
                unit="%",
            )
        return None

    return [
        AlertRule("rule:autonomy:reserve", AlertSource.DEPENDENCY, _eval_autonomy),
        AlertRule("rule:generation:n_minus_one", AlertSource.DEPENDENCY, _eval_n_minus_one),
        AlertRule("rule:heating:thermal_load", AlertSource.DEPENDENCY, _eval_boiler_load),
    ]


class AlertEngine:
    """Evaluates rules against Twin state, updates alert records, and logs lifecycle events."""

    def __init__(self, session: Session, rules: list[AlertRule] | None = None):
        self.session = session
        self.rules = rules if rules is not None else build_default_rules()

    def evaluate(self, station_id: str, dep: DependencyEvaluation, evaluated_at: datetime | None = None) -> list[TwinAlert]:
        now = evaluated_at or utcnow()
        active_alerts: dict[str, TwinAlert] = {
            a.dedup_key: a
            for a in self.session.scalars(
                select(TwinAlert).where(
                    TwinAlert.station_id == station_id,
                    TwinAlert.state.in_(list(ACTIVE_ALERT_STATES)),
                )
            ).all()
        }

        updated_or_created: list[TwinAlert] = []

        for rule in self.rules:
            dedup_key = f"{station_id}:{rule.rule_id}"
            res = rule.evaluator(station_id, dep)
            existing = active_alerts.get(dedup_key)

            if res and res.triggered:
                if existing:
                    # Check escalation
                    if res.severity == AlertSeverity.CRITICAL and existing.severity == AlertSeverity.WARNING:
                        existing.severity = AlertSeverity.CRITICAL
                        existing.message = res.message
                        self._log_event(
                            station_id=station_id,
                            event_type=EventType.ALERT_ESCALATED,
                            severity=AlertSeverity.CRITICAL,
                            message=f"Alert '{existing.title}' escalated to CRITICAL: {res.message}",
                            alert_id=existing.id,
                            ts=now,
                        )
                    existing.last_evaluated_at = now
                    existing.occurrences += 1
                    existing.clear_streak = 0
                    existing.value = res.value
                    updated_or_created.append(existing)
                else:
                    # Raise new alert
                    alert_id = f"alt-{uuid.uuid4().hex[:12]}"
                    alert = TwinAlert(
                        id=alert_id,
                        station_id=station_id,
                        rule_id=rule.rule_id,
                        dedup_key=dedup_key,
                        severity=res.severity,
                        state=AlertState.OPEN,
                        source=rule.source,
                        domain=res.domain,
                        title=res.title,
                        message=res.message,
                        recommended_action=res.recommended_action,
                        asset_id=res.asset_id,
                        channel_id=res.channel_id,
                        node_id=res.node_id,
                        value=res.value,
                        threshold=res.threshold,
                        unit=res.unit,
                        evidence_provenance="DERIVED",
                        raised_at=now,
                        last_evaluated_at=now,
                        occurrences=1,
                        clear_streak=0,
                    )
                    self.session.add(alert)
                    self._log_event(
                        station_id=station_id,
                        event_type=EventType.ALERT_RAISED,
                        severity=res.severity,
                        message=f"Alert raised: {res.title} — {res.message}",
                        alert_id=alert_id,
                        ts=now,
                    )
                    updated_or_created.append(alert)
            else:
                # Rule condition not active
                if existing:
                    existing.clear_streak += 1
                    if existing.clear_streak >= 1:
                        # Auto-resolve
                        existing.state = AlertState.RESOLVED
                        existing.resolved_at = now
                        self._log_event(
                            station_id=station_id,
                            event_type=EventType.ALERT_RESOLVED,
                            severity=AlertSeverity.INFO,
                            message=f"Alert resolved: '{existing.title}' condition has returned to normal.",
                            alert_id=existing.id,
                            ts=now,
                        )
                        updated_or_created.append(existing)

        self.session.flush()
        return updated_or_created

    def acknowledge(self, alert_id: str, actor: str, note: str | None = None) -> TwinAlert:
        alert = self.session.get(TwinAlert, alert_id)
        if not alert:
            raise KeyError(f"Alert '{alert_id}' not found")
        now = utcnow()
        alert.state = AlertState.ACKNOWLEDGED
        alert.acknowledged_at = now
        alert.acknowledged_by = actor
        alert.acknowledgement_note = note
        self._log_event(
            station_id=alert.station_id,
            event_type=EventType.ALERT_ACKNOWLEDGED,
            severity=AlertSeverity.INFO,
            message=f"Alert '{alert.title}' acknowledged by {actor}" + (f": {note}" if note else ""),
            alert_id=alert.id,
            actor=actor,
            ts=now,
        )
        self.session.flush()
        return alert

    def _log_event(
        self,
        station_id: str,
        event_type: EventType,
        severity: AlertSeverity,
        message: str,
        alert_id: str | None = None,
        actor: str | None = None,
        ts: datetime | None = None,
    ) -> None:
        ev = TwinEvent(
            occurred_at=ts or utcnow(),
            recorded_at=utcnow(),
            station_id=station_id,
            event_type=event_type,
            severity=severity,
            message=message,
            alert_id=alert_id,
            actor=actor,
        )
        self.session.add(ev)
