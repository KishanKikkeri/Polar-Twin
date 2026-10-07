"""Living Digital Twin Runtime Service.

Orchestrates:
- Deterministic simulation clock & station simulators (Maitri & Bharati)
- Edge-to-HQ ingestion pipeline
- Causal state propagation and live graph evaluation
- Real-time alert rule evaluations and lifecycle
- Snapshot generation conforming to the Agent 4C TwinState contract (§1)
"""

import threading
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.timeutil import ensure_utc, utcnow
from app.db.session import get_session_factory
from app.domain.runtime_enums import EventType
from app.models.runtime import TwinAlert, TwinEvent
from app.observability.metrics import REGISTRY, MetricsRegistry
from app.runtime.alerts import AlertEngine
from app.runtime.causal_model import build_station_causal_graph
from app.runtime.clock import SimulationClock
from app.runtime.dependency import DependencyEvaluation, ImpactResult
from app.runtime.ingestion import IngestionPipeline
from app.runtime.simulator import StationSimulator
from app.runtime.telemetry_event import TelemetryEvent

logger = get_logger("polartwin.runtime")


class TwinRuntimeService:
    def __init__(
        self,
        session_factory=None,
        settings: Settings | None = None,
        registry: MetricsRegistry = REGISTRY,
        clock: SimulationClock | None = None,
    ):
        self.session_factory = session_factory or get_session_factory()
        self.settings = settings or get_settings()
        self.registry = registry

        start_time = utcnow()
        self.clock = clock or SimulationClock(start=start_time, step_seconds=self.settings.runtime_step_seconds)

        self.simulators: dict[str, StationSimulator] = {}
        for st in self.settings.runtime_stations:
            self.simulators[st] = StationSimulator(
                station_id=st,
                clock=self.clock,
                seed=self.settings.runtime_seed,
            )

        self._latest_evaluations: dict[str, DependencyEvaluation] = {}
        self._lock = threading.Lock()

        self.gauge_ticks = registry.gauge("polartwin_runtime_ticks_total", "Simulation ticks executed")
        self.gauge_sim_time = registry.gauge("polartwin_runtime_sim_time_epoch", "Simulation current epoch")

    def _execute_with_session(self, session: Session | None, func):
        if session is not None:
            return func(session)
        with self.session_factory() as s:
            res = func(s)
            s.commit()
            return res

    def tick(self, session: Session | None = None) -> dict[str, Any]:
        """Perform one global simulation step across all stations, ingest telemetry, and evaluate alerts."""
        with self._lock:
            sim_time = self.clock.now()
            results: dict[str, Any] = {}

            def _step_all(sess: Session):
                pipeline = IngestionPipeline(session=sess, settings=self.settings, registry=self.registry)
                alert_engine = AlertEngine(session=sess)

                for st_id, sim in self.simulators.items():
                    dep, events = sim.step()
                    self._latest_evaluations[st_id] = dep
                    batch_res = pipeline.process_batch(events, received_at=sim_time)
                    alerts = alert_engine.evaluate(station_id=st_id, dep=dep, evaluated_at=sim_time)

                    results[st_id] = {
                        "sim_time": sim_time.isoformat(),
                        "dep_hash": dep.result_hash(),
                        "events_emitted": len(events),
                        "events_accepted": batch_res.accepted,
                        "active_alerts": len(alerts),
                    }
                sess.flush()
                return results

            self._execute_with_session(session, _step_all)

            self.clock.advance(1)
            self.gauge_ticks.set(self.clock.ticks)
            self.gauge_sim_time.set(self.clock.now().timestamp())
            return results

    def get_evaluation(self, station_id: str) -> DependencyEvaluation:
        with self._lock:
            if station_id in self._latest_evaluations:
                return self._latest_evaluations[station_id]

            sim = self.simulators.get(station_id)
            if not sim:
                graph = build_station_causal_graph(station_id)
                return graph.evaluate({})
            dep, _ = sim.step()
            self._latest_evaluations[station_id] = dep
            return dep

    def get_twin_state_contract(
        self,
        station_id: str,
        as_of: datetime | None = None,
        session: Session | None = None,
    ) -> dict[str, Any]:
        """Produces the exact TwinState contract required by Agent 4C (§1 in agent4c-contracts.md)."""
        dep = self.get_evaluation(station_id)
        now_iso = (as_of or self.clock.now()).isoformat()

        active_alerts: list[dict[str, str]] = []

        def _fetch_alerts(sess: Session):
            try:
                rows = sess.scalars(
                    select(TwinAlert).where(
                        TwinAlert.station_id == station_id,
                        TwinAlert.state.in_(["OPEN", "ACKNOWLEDGED"]),
                    )
                ).all()
                for a in rows:
                    active_alerts.append(
                        {
                            "id": a.id,
                            "severity": a.severity.value.lower(),
                            "category": a.domain.value.lower() if a.domain else "station",
                            "message": f"{a.title}: {a.message}",
                        }
                    )
            except Exception:
                pass

        try:
            self._execute_with_session(session, _fetch_alerts)
        except Exception:
            pass

        is_maitri = station_id.lower() == "maitri"
        gen_name = "dg" if is_maitri else "chp"

        return {
            "stationId": station_id,
            "asOf": now_iso,
            "assets": [
                {
                    "id": f"{station_id}.{gen_name}-1",
                    "type": "generator",
                    "status": "online",
                    "capacityKw": 125.0 if is_maitri else 100.0,
                    "loading": dep.value(f"{station_id}.generators.unit1_load_kw"),
                },
                {
                    "id": f"{station_id}.{gen_name}-2",
                    "type": "generator",
                    "status": "online",
                    "capacityKw": 125.0 if is_maitri else 100.0,
                    "loading": dep.value(f"{station_id}.generators.unit2_load_kw"),
                },
                {
                    "id": f"{station_id}.{gen_name}-3",
                    "type": "generator",
                    "status": "online",
                    "capacityKw": 125.0 if is_maitri else 100.0,
                    "loading": dep.value(f"{station_id}.generators.unit3_load_kw"),
                },
            ],
            "energy": {
                "baseDemandKw": dep.value(f"{station_id}.energy.total_load_kw") or 65.0,
                "batteryKwh": 120.0,
                "batteryCapacityKwh": 150.0,
            },
            "fuel": {
                "tankL": (dep.value(f"{station_id}.inventory.total_volume_kl") or 300.0) * 1000.0,
                "resupplyL": 450000.0,
                "burnLph": dep.value(f"{station_id}.fuel.burn_rate_lph") or 25.0,
            },
            "logistics": {
                "nextResupplyH": int((dep.value(f"{station_id}.logistics.days_of_autonomy") or 120.0) * 24.0),
                "daysOfAutonomy": dep.value(f"{station_id}.logistics.days_of_autonomy"),
            },
            "thermal": {
                "indoorC": 21.0,
                "heatingDemandKw": dep.value(f"{station_id}.heating.demand_kw"),
            },
            "comms": {
                "linkQuality": 0.95,
            },
            "environment": {
                "outdoorC": dep.value(f"{station_id}.env.air_temp_c") or -15.0,
                "windMs": dep.value(f"{station_id}.env.wind_speed_ms") or 8.0,
            },
            "risk": {
                "score": dep.value(f"{station_id}.risk.composite_score"),
                "nMinusOneMarginPct": dep.value(f"{station_id}.risk.n_minus_1_margin_pct"),
            },
            "alerts": active_alerts,
        }

    def apply_perturbation(self, station_id: str, node_id: str, value: float) -> ImpactResult:
        sim = self.simulators.get(station_id)
        if not sim:
            raise KeyError(f"Station '{station_id}' not found")
        sim.set_perturbation(node_id, value)
        current_dep = self.get_evaluation(station_id)
        impact = sim.graph.impact(current_dep.values(), {node_id: value})
        return impact

    def clear_perturbation(self, station_id: str, node_id: str) -> None:
        sim = self.simulators.get(station_id)
        if sim:
            sim.clear_perturbation(node_id)


_runtime_service: TwinRuntimeService | None = None


def get_runtime_service() -> TwinRuntimeService:
    global _runtime_service
    if _runtime_service is None:
        _runtime_service = TwinRuntimeService()
    return _runtime_service
