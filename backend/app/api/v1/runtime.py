"""Phase 4A Runtime, Ingestion, Causal Dependency, Alerts, and Audit endpoints."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.domain.runtime_enums import (
    AlertSeverity,
    AlertState,
    AuditOutcome,
    Permission,
    Role,
)
from app.models.runtime import AuditEvent, TwinAlert, TwinEvent
from app.observability.metrics import REGISTRY
from app.runtime.alerts import AlertEngine
from app.runtime.causal_model import build_station_causal_graph
from app.runtime.ingestion import IngestionPipeline
from app.runtime.security import (
    AuthenticatedUser,
    AuditLogger,
    create_token,
    get_current_user,
    require_permission,
)
from app.runtime.service import TwinRuntimeService, get_runtime_service
from app.runtime.telemetry_event import IngestionBatchResult, IngestionRecord, TelemetryEvent

router = APIRouter(prefix="", tags=["runtime"])
DbSession = Annotated[Session, Depends(get_db)]


# ---------------------------------------------------------------------------
# Telemetry Ingestion
# ---------------------------------------------------------------------------


class IngestPayload(BaseModel):
    events: list[TelemetryEvent] = Field(description="One or more telemetry events to ingest")


@router.post(
    "/telemetry/ingest",
    response_model=IngestionBatchResult,
    summary="Ingest telemetry events into the Twin runtime",
)
def ingest_telemetry(
    payload: IngestPayload,
    db: DbSession,
    user: AuthenticatedUser = Depends(require_permission(Permission.TELEMETRY_INGEST)),
) -> IngestionBatchResult:
    pipeline = IngestionPipeline(session=db)
    result = pipeline.process_batch(payload.events)
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Runtime & Simulation Control
# ---------------------------------------------------------------------------


@router.get("/runtime/status", summary="Get runtime simulation status and counters")
def get_runtime_status(
    user: AuthenticatedUser = Depends(require_permission(Permission.RUNTIME_READ)),
    svc: TwinRuntimeService = Depends(get_runtime_service),
) -> dict[str, Any]:
    return {
        "status": "operational",
        "clock_mode": svc.settings.runtime_clock_mode,
        "sim_time": svc.clock.now().isoformat(),
        "ticks": svc.clock.ticks,
        "step_seconds": svc.clock.step.total_seconds(),
        "active_stations": list(svc.simulators.keys()),
        "metrics": {
            "ingest_received": REGISTRY.counter("polartwin_ingest_received_total").total(),
            "ingest_accepted": REGISTRY.counter("polartwin_ingest_accepted_total").total(),
            "ingest_duplicates": REGISTRY.counter("polartwin_ingest_duplicates_total").total(),
            "ingest_conflicts": REGISTRY.counter("polartwin_ingest_conflicts_total").total(),
        },
    }


@router.post("/runtime/step", summary="Advance simulation by one tick")
def step_runtime(
    db: DbSession,
    user: AuthenticatedUser = Depends(require_permission(Permission.RUNTIME_CONTROL)),
    svc: TwinRuntimeService = Depends(get_runtime_service),
) -> dict[str, Any]:
    return svc.tick(session=db)


# ---------------------------------------------------------------------------
# Causal Dependency Graph & 4C TwinState Contract
# ---------------------------------------------------------------------------


@router.get("/runtime/{station_id}/dependency-graph", summary="Describe the station's causal DAG")
def get_dependency_graph(
    station_id: str = Path(..., description="e.g. maitri, bharati"),
    user: AuthenticatedUser = Depends(require_permission(Permission.TWIN_READ)),
) -> dict[str, Any]:
    graph = build_station_causal_graph(station_id)
    return graph.describe()


@router.get("/runtime/{station_id}/state", summary="Agent 4C-compliant TwinState snapshot")
def get_twin_state(
    station_id: str,
    db: DbSession,
    user: AuthenticatedUser = Depends(require_permission(Permission.TWIN_READ)),
    svc: TwinRuntimeService = Depends(get_runtime_service),
) -> dict[str, Any]:
    return svc.get_twin_state_contract(station_id, session=db)


class PerturbRequest(BaseModel):
    node_id: str = Field(description="Causal DAG node to perturb (e.g. maitri.env.air_temp_c)")
    value: float = Field(description="New value for the node")


@router.post("/runtime/{station_id}/perturb", summary="Inject scenario perturbation and compute causal impact")
def perturb_station(
    req: PerturbRequest,
    station_id: str = Path(..., description="e.g. maitri, bharati"),
    user: AuthenticatedUser = Depends(require_permission(Permission.PERTURBATION_APPLY)),
    svc: TwinRuntimeService = Depends(get_runtime_service),
    db: DbSession = None,  # type: ignore
) -> dict[str, Any]:
    impact = svc.apply_perturbation(station_id, req.node_id, req.value)
    if db:
        AuditLogger(db).log(
            actor=user,
            action="PERTURBATION_APPLIED",
            resource_type="node",
            resource_id=req.node_id,
            station_id=station_id,
            details={"value": req.value},
        )
        db.commit()
    return impact.to_dict()


# ---------------------------------------------------------------------------
# Alerts & Lifecycle
# ---------------------------------------------------------------------------


@router.get("/alerts", summary="List operational alerts")
def list_alerts(
    db: DbSession,
    station_id: str | None = None,
    state: AlertState | None = None,
    severity: AlertSeverity | None = None,
    user: AuthenticatedUser = Depends(require_permission(Permission.ALERTS_READ)),
) -> list[dict[str, Any]]:
    stmt = select(TwinAlert)
    if station_id:
        stmt = stmt.where(TwinAlert.station_id == station_id)
    if state:
        stmt = stmt.where(TwinAlert.state == state)
    if severity:
        stmt = stmt.where(TwinAlert.severity == severity)
    rows = db.scalars(stmt.order_by(TwinAlert.raised_at.desc())).all()
    return [
        {
            "id": a.id,
            "station_id": a.station_id,
            "rule_id": a.rule_id,
            "title": a.title,
            "message": a.message,
            "severity": a.severity.value,
            "state": a.state.value,
            "source": a.source.value,
            "domain": a.domain.value if a.domain else None,
            "recommended_action": a.recommended_action,
            "raised_at": a.raised_at.isoformat(),
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
            "acknowledged_by": a.acknowledged_by,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "occurrences": a.occurrences,
        }
        for a in rows
    ]


class AcknowledgeRequest(BaseModel):
    note: str | None = Field(default=None, description="Operator acknowledgement rationale")


@router.post("/alerts/{alert_id}/acknowledge", summary="Acknowledge an active alert")
def acknowledge_alert(
    alert_id: str,
    req: AcknowledgeRequest,
    db: DbSession,
    user: AuthenticatedUser = Depends(require_permission(Permission.ALERTS_ACKNOWLEDGE)),
) -> dict[str, Any]:
    engine = AlertEngine(session=db)
    try:
        alert = engine.acknowledge(alert_id, actor=user.user_id, note=req.note)
        AuditLogger(db).log(
            actor=user,
            action="ALERT_ACKNOWLEDGED",
            resource_type="alert",
            resource_id=alert_id,
            station_id=alert.station_id,
            details={"note": req.note},
        )
        db.commit()
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")

    return {
        "id": alert.id,
        "state": alert.state.value,
        "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "acknowledged_by": alert.acknowledged_by,
    }


# ---------------------------------------------------------------------------
# Operational Events
# ---------------------------------------------------------------------------


@router.get("/events", summary="List operational twin events")
def list_events(
    db: DbSession,
    station_id: str | None = None,
    limit: int = 100,
    user: AuthenticatedUser = Depends(require_permission(Permission.TWIN_READ)),
) -> list[dict[str, Any]]:
    stmt = select(TwinEvent)
    if station_id:
        stmt = stmt.where(TwinEvent.station_id == station_id)
    rows = db.scalars(stmt.order_by(TwinEvent.id.desc()).limit(limit)).all()
    return [
        {
            "id": e.id,
            "occurred_at": e.occurred_at.isoformat(),
            "station_id": e.station_id,
            "event_type": e.event_type.value,
            "severity": e.severity.value,
            "message": e.message,
            "alert_id": e.alert_id,
            "actor": e.actor,
        }
        for e in rows
    ]


# ---------------------------------------------------------------------------
# Audit Trail
# ---------------------------------------------------------------------------


@router.get("/audit", summary="Read tamper-evident audit trail")
def list_audit(
    db: DbSession,
    limit: int = 100,
    user: AuthenticatedUser = Depends(require_permission(Permission.AUDIT_READ)),
) -> dict[str, Any]:
    logger_tool = AuditLogger(db)
    is_valid = logger_tool.verify_chain()
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit)).all()
    return {
        "chain_intact": is_valid,
        "events": [
            {
                "id": ev.id,
                "occurred_at": ev.occurred_at.isoformat(),
                "actor_id": ev.actor_id,
                "actor_roles": ev.actor_roles,
                "action": ev.action,
                "resource_type": ev.resource_type,
                "resource_id": ev.resource_id,
                "station_id": ev.station_id,
                "outcome": ev.outcome.value,
                "hash": ev.hash,
                "prev_hash": ev.prev_hash,
            }
            for ev in rows
        ],
    }


# ---------------------------------------------------------------------------
# Auth Helper (Dev / Test Token Minting)
# ---------------------------------------------------------------------------


class TokenRequest(BaseModel):
    user_id: str
    roles: list[Role]
    station_ids: list[str] = Field(default_factory=list)


@router.post("/auth/token", summary="Generate a dev/test bearer token")
def mint_token(req: TokenRequest) -> dict[str, str]:
    token = create_token(user_id=req.user_id, roles=req.roles, station_ids=req.station_ids)
    return {"access_token": token, "token_type": "Bearer"}
