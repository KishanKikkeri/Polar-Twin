"""Tests for causal simulation and dependency propagation.

Verifies:
1. Determinism: identical seed + inputs yields bit-identical outputs.
2. Antarctic Causal Chain:
   Temperature drops
     ↓
   Heating demand rises
     ↓
   Station electrical load rises
     ↓
   Generator output rises
     ↓
   Fuel burn rate rises
     ↓
   Days of autonomy falls
3. Perturbation & What-If impact propagation.
"""

from datetime import UTC, datetime

from app.runtime.causal_model import build_station_causal_graph
from app.runtime.clock import SimulationClock
from app.runtime.simulator import StationSimulator


def test_simulation_is_strictly_deterministic():
    t0 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
    clock1 = SimulationClock(start=t0, step_seconds=60)
    clock2 = SimulationClock(start=t0, step_seconds=60)

    sim1 = StationSimulator("maitri", clock=clock1, seed=42)
    sim2 = StationSimulator("maitri", clock=clock2, seed=42)

    # Step both 5 times
    for _ in range(5):
        dep1, evs1 = sim1.step()
        clock1.advance(1)
        dep2, evs2 = sim2.step()
        clock2.advance(1)

        assert dep1.result_hash() == dep2.result_hash()
        assert len(evs1) == len(evs2)
        for e1, e2 in zip(evs1, evs2, strict=True):
            assert e1.channel_id == e2.channel_id
            assert e1.value == e2.value
            assert e1.observed_at == e2.observed_at


def test_antarctic_causal_chain_propagation():
    """Verify physical coupling: temperature drop -> heating rises -> electrical load rises -> burn rises -> autonomy falls."""
    graph = build_station_causal_graph("maitri")

    baseline_obs = {
        "maitri.env.air_temp_c": -10.0,
        "maitri.env.wind_speed_ms": 5.0,
        "maitri.inventory.tank_a_pct": 75.0,
        "maitri.inventory.tank_b_pct": 75.0,
        "maitri.inventory.tank_c_pct": 75.0,
    }
    base_eval = graph.evaluate(baseline_obs)

    # Cold blizzard condition: temp drops to -35 C, wind increases to 25 m/s
    cold_obs = dict(baseline_obs)
    cold_obs["maitri.env.air_temp_c"] = -35.0
    cold_obs["maitri.env.wind_speed_ms"] = 25.0
    cold_eval = graph.evaluate(cold_obs)

    # 1. Heating demand increases
    base_heat = base_eval.value("maitri.heating.demand_kw")
    cold_heat = cold_eval.value("maitri.heating.demand_kw")
    assert cold_heat > base_heat, f"Heating demand should rise: {cold_heat} > {base_heat}"

    # 2. Total electrical power demand increases
    base_elec = base_eval.value("maitri.energy.total_load_kw")
    cold_elec = cold_eval.value("maitri.energy.total_load_kw")
    assert cold_elec > base_elec, f"Electric load should rise: {cold_elec} > {base_elec}"

    # 3. Generator unit loading increases
    base_gen1 = base_eval.value("maitri.generators.unit1_load_kw")
    cold_gen1 = cold_eval.value("maitri.generators.unit1_load_kw")
    assert cold_gen1 > base_gen1

    # 4. Hourly fuel burn rate increases
    base_burn = base_eval.value("maitri.fuel.burn_rate_lph")
    cold_burn = cold_eval.value("maitri.fuel.burn_rate_lph")
    assert cold_burn > base_burn

    # 5. Days of autonomy decreases
    base_autonomy = base_eval.value("maitri.logistics.days_of_autonomy")
    cold_autonomy = cold_eval.value("maitri.logistics.days_of_autonomy")
    assert cold_autonomy < base_autonomy, f"Autonomy should drop: {cold_autonomy} < {base_autonomy}"


def test_causal_impact_analysis():
    graph = build_station_causal_graph("bharati")
    obs = {
        "bharati.env.air_temp_c": -12.0,
        "bharati.env.wind_speed_ms": 8.0,
        "bharati.inventory.tank_a_pct": 60.0,
        "bharati.inventory.tank_b_pct": 60.0,
    }

    # Perturb outdoor temp by dropping to -30 C
    impact = graph.impact(obs, {"bharati.env.air_temp_c": -30.0})

    heat_row = impact.row("bharati.heating.demand_kw")
    assert heat_row.delta > 0
    assert heat_row.pct_change > 0
    assert "bharati.env.air_temp_c" in heat_row.path

    burn_row = impact.row("bharati.fuel.burn_rate_lph")
    assert burn_row.delta > 0
