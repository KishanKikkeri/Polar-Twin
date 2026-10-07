"""Deterministic causal station simulator.

Advances physical and operational state step-by-step using the causal DAG
defined in ``app.runtime.causal_model``. Emits canonical ``TelemetryEvent``
records labelled ``SYNTHETIC`` or ``SIMULATED``.
"""

import math
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.timeutil import ensure_utc
from app.domain.enums import Provenance, Quality
from app.runtime.causal_model import build_station_causal_graph
from app.runtime.clock import SimulationClock
from app.runtime.dependency import DependencyEvaluation, DependencyGraph
from app.runtime.determinism import normal, uniform
from app.runtime.telemetry_event import TelemetryEvent


class StationSimulator:
    """Simulates one Antarctic station deterministically."""

    def __init__(
        self,
        station_id: str,
        clock: SimulationClock,
        seed: int = 20261007,
        graph: DependencyGraph | None = None,
    ):
        self.station_id = station_id
        self.clock = clock
        self.seed = seed
        self.graph = graph or build_station_causal_graph(station_id)

        # Baseline weather state
        self.base_temp_c = -14.0 if station_id.lower() == "maitri" else -16.0
        self.base_wind_ms = 9.0 if station_id.lower() == "maitri" else 11.0

        # Tank levels (% of capacity, starts full/high)
        self.tank_a_pct = 75.0
        self.tank_b_pct = 72.0
        self.tank_c_pct = 78.0

        # Active perturbations (node_id -> override_value)
        self.perturbations: dict[str, float] = {}

    def set_perturbation(self, node_id: str, value: float) -> None:
        """Inject a scenario fault or condition change."""
        self.perturbations[node_id] = value

    def clear_perturbation(self, node_id: str) -> None:
        self.perturbations.pop(node_id, None)

    def clear_all_perturbations(self) -> None:
        self.perturbations.clear()

    def step(self) -> tuple[DependencyEvaluation, list[TelemetryEvent]]:
        """Advance one clock tick, evaluate the causal graph, and emit telemetry events."""
        now = self.clock.now()
        step_idx = self.clock.ticks

        # 1. Deterministic diurnal cycle (24-hour periodicity) + stochastic weather noise
        seconds_of_day = (now.hour * 3600) + (now.minute * 60) + now.second
        diurnal_temp = 3.5 * math.sin(2 * math.pi * (seconds_of_day - 6 * 3600) / 86400)
        temp_noise = 0.4 * normal(self.seed, self.station_id, step_idx, "temp_noise")
        current_temp = self.base_temp_c + diurnal_temp + temp_noise

        wind_noise = 1.2 * normal(self.seed, self.station_id, step_idx, "wind_noise")
        current_wind = max(0.5, self.base_wind_ms + wind_noise)

        # 2. Prepare observations for the causal DAG
        observations: dict[str, float | None] = {
            f"{self.station_id}.env.air_temp_c": round(current_temp, 2),
            f"{self.station_id}.env.wind_speed_ms": round(current_wind, 2),
            f"{self.station_id}.inventory.tank_a_pct": round(self.tank_a_pct, 2),
            f"{self.station_id}.inventory.tank_b_pct": round(self.tank_b_pct, 2),
        }
        if f"{self.station_id}.inventory.tank_c_pct" in self.graph.nodes:
            observations[f"{self.station_id}.inventory.tank_c_pct"] = round(self.tank_c_pct, 2)

        # Apply perturbations
        for k, v in self.perturbations.items():
            if k in observations:
                observations[k] = v

        # 3. Evaluate the DAG
        dep = self.graph.evaluate(observations)

        # 4. Integrate physical dynamics (fuel depletion over the time step)
        step_hours = self.clock.step.total_seconds() / 3600.0
        burn_rate_kld = dep.value(f"{self.station_id}.fuel.burn_rate_kld") or 1.8
        fuel_used_kl = (burn_rate_kld / 24.0) * step_hours

        # Deplete tanks proportionally
        if fuel_used_kl > 0:
            tank_cap_per_pct = 1.5 if self.station_id.lower() == "maitri" else 1.7
            pct_drop = (fuel_used_kl / (3 if self.station_id.lower() == "maitri" else 2)) / tank_cap_per_pct
            self.tank_a_pct = max(0.0, self.tank_a_pct - pct_drop)
            self.tank_b_pct = max(0.0, self.tank_b_pct - pct_drop)
            if self.station_id.lower() == "maitri":
                self.tank_c_pct = max(0.0, self.tank_c_pct - pct_drop)

        # 5. Emit TelemetryEvents mapped to physical channels
        events: list[TelemetryEvent] = []
        for node_id, res in dep.results.items():
            if res.channel_id and res.value is not None:
                # Split '<station>.<asset_code>.<metric>'
                parts = res.channel_id.split(".")
                asset_id = ".".join(parts[:2])
                metric = parts[2]
                events.append(
                    TelemetryEvent(
                        event_id=f"sim-{self.station_id}-{parts[1]}-{metric}-{int(now.timestamp())}",
                        station_id=self.station_id,
                        asset_id=asset_id,
                        channel_id=res.channel_id,
                        metric=metric,
                        unit=res.unit,
                        observed_at=now,
                        value=res.value,
                        provenance=Provenance.SYNTHETIC,
                        quality=Quality.GOOD,
                        source="sim:causal:v1",
                        sequence_num=step_idx,
                    )
                )

        return dep, events
