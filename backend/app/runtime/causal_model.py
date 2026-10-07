"""Scientifically and domain-grounded causal model for Maitri and Bharati.

Causal Chain:
    Environment (outdoor temp, wind)
      ↓
    Heating (thermal losses UA*(T_in - T_out), wind chilling, boiler/CHP heat load)
      ↓
    Energy (base electrical load + HVAC auxiliaries + water heating)
      ↓
    Generators (dispatch logic, DG loading %, frequency & voltage stability)
      ↓
    Fuel (specific fuel consumption SFC curve, burn rate in L/h and kL/day)
      ↓
    Inventory (active tank depletion, total storage volume in kL)
      ↓
    Logistics (autonomy in days = inventory / burn_rate, resupply margin)
      ↓
    Risk / Events (reserve risk index, N-1 capacity margin, extreme cold alerts)

All relationships are formulated as pure deterministic functions with physical units.
Every generated reading is labelled SYNTHETIC or DERIVED.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass

from app.domain.runtime_enums import TwinDomain
from app.runtime.dependency import DependencyGraph, Node

MODEL_VERSION = "polar-causal-v1"


@dataclass(frozen=True)
class StationThermalCoeffs:
    """Building thermal parameters for polar conditions."""
    ua_envelope_kw_per_c: float  # Building conductance (kW/degC)
    wind_chill_factor: float     # Extra loss fraction per m/s wind
    target_indoor_c: float       # Target indoor comfort temperature (degC)
    base_elec_kw: float          # Base non-heating electrical load (lights, instruments, comms)
    tank_capacity_kl: float      # Total bulk storage capacity in kL
    nominal_nominal_burn_rate_kl_day: float


MAITRI_COEFFS = StationThermalCoeffs(
    ua_envelope_kw_per_c=1.85,
    wind_chill_factor=0.015,
    target_indoor_c=21.0,
    base_elec_kw=42.0,
    tank_capacity_kl=450.0,
    nominal_nominal_burn_rate_kl_day=1.80,
)

BHARATI_COEFFS = StationThermalCoeffs(
    ua_envelope_kw_per_c=1.40,
    wind_chill_factor=0.012,
    target_indoor_c=20.5,
    base_elec_kw=38.0,
    tank_capacity_kl=340.0,
    nominal_nominal_burn_rate_kl_day=1.50,
)


def specific_fuel_consumption(load_pct: float) -> float:
    """Specific fuel consumption (L / kWh) for medium-speed polar diesel generators."""
    l = max(10.0, min(110.0, load_pct)) / 100.0
    sfc = 0.240 + 0.045 * ((l - 0.75) ** 2) / (0.75 ** 2) + (0.035 if l < 0.35 else 0.0)
    return max(0.230, min(0.400, sfc))


def build_station_causal_graph(station_id: str) -> DependencyGraph:
    """Build the explicit causal DAG for a given Antarctic station."""
    coeffs = MAITRI_COEFFS if station_id.lower() == "maitri" else BHARATI_COEFFS
    is_maitri = station_id.lower() == "maitri"

    nodes: list[Node] = []

    # ---------------- 1. ENVIRONMENT DOMAIN ----------------
    nodes.append(
        Node(
            id=f"{station_id}.env.air_temp_c",
            domain=TwinDomain.ENVIRONMENT,
            unit="degC",
            description="Outdoor ambient temperature measured by automatic weather station",
            channel_id=f"{station_id}.aws-1.air_temp_c",
            observation_policy="prefer_observed",
            lower=-60.0,
            upper=15.0,
        )
    )
    nodes.append(
        Node(
            id=f"{station_id}.env.wind_speed_ms",
            domain=TwinDomain.ENVIRONMENT,
            unit="m/s",
            description="10m wind speed from weather station anemometer",
            channel_id=f"{station_id}.aws-1.wind_speed_ms",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=75.0,
        )
    )

    # ---------------- 2. HEATING DOMAIN ----------------
    def _heating_demand(inputs: Mapping[str, float]) -> float:
        t_out = inputs[f"{station_id}.env.air_temp_c"]
        wind = inputs[f"{station_id}.env.wind_speed_ms"]
        delta_t = max(0.0, coeffs.target_indoor_c - t_out)
        wind_mult = 1.0 + coeffs.wind_chill_factor * wind
        return coeffs.ua_envelope_kw_per_c * delta_t * wind_mult

    nodes.append(
        Node(
            id=f"{station_id}.heating.demand_kw",
            domain=TwinDomain.HEATING,
            unit="kW",
            description="Total station thermal heating demand load",
            inputs=(f"{station_id}.env.air_temp_c", f"{station_id}.env.wind_speed_ms"),
            relation=_heating_demand,
            formula=f"{coeffs.ua_envelope_kw_per_c} * ({coeffs.target_indoor_c} - T_out) * (1 + {coeffs.wind_chill_factor}*wind)",
            observation_policy="prefer_computed",
            lower=5.0,
            upper=350.0,
        )
    )

    def _boiler_load_pct(inputs: Mapping[str, float]) -> float:
        demand = inputs[f"{station_id}.heating.demand_kw"]
        rated_cap = 120.0
        return min(100.0, max(15.0, (demand / rated_cap) * 100.0))

    boiler_channel = f"{station_id}.boiler-1.load_pct" if is_maitri else f"{station_id}.heat-exchanger-1.load_pct"
    nodes.append(
        Node(
            id=f"{station_id}.heating.boiler_load_pct",
            domain=TwinDomain.HEATING,
            unit="%",
            description="Heating plant firing / heat-exchanger load percentage",
            inputs=(f"{station_id}.heating.demand_kw",),
            relation=_boiler_load_pct,
            formula="heating.demand_kw / 120.0 * 100",
            channel_id=boiler_channel,
            observation_policy="prefer_observed",
            lower=0.0,
            upper=100.0,
        )
    )

    # ---------------- 3. ENERGY DOMAIN ----------------
    def _station_elec_load(inputs: Mapping[str, float]) -> float:
        q_heat = inputs[f"{station_id}.heating.demand_kw"]
        aux_elec = 0.18 * q_heat
        return coeffs.base_elec_kw + aux_elec

    nodes.append(
        Node(
            id=f"{station_id}.energy.total_load_kw",
            domain=TwinDomain.ENERGY,
            unit="kW",
            description="Station LV main bus total active power load",
            inputs=(f"{station_id}.heating.demand_kw",),
            relation=_station_elec_load,
            formula=f"{coeffs.base_elec_kw} + 0.18 * heating.demand_kw",
            channel_id=f"{station_id}.power-bus.station_load_kw",
            observation_policy="prefer_observed",
            lower=20.0,
            upper=250.0,
        )
    )

    # ---------------- 4. GENERATORS DOMAIN ----------------
    gen_prefix = "dg" if is_maitri else "chp"
    gen_capacity = 125.0 if is_maitri else 100.0

    def _gen1_load(inputs: Mapping[str, float]) -> float:
        total = inputs[f"{station_id}.energy.total_load_kw"]
        return min(gen_capacity * 0.95, total * 0.55)

    def _gen2_load(inputs: Mapping[str, float]) -> float:
        total = inputs[f"{station_id}.energy.total_load_kw"]
        return max(10.0, total * 0.30)

    def _gen3_load(inputs: Mapping[str, float]) -> float:
        total = inputs[f"{station_id}.energy.total_load_kw"]
        rem = total - (total * 0.55) - (total * 0.30)
        return max(8.0, rem)

    nodes.append(
        Node(
            id=f"{station_id}.generators.unit1_load_kw",
            domain=TwinDomain.GENERATORS,
            unit="kW",
            description=f"Unit 1 ({gen_prefix.upper()}-1) active output",
            inputs=(f"{station_id}.energy.total_load_kw",),
            relation=_gen1_load,
            formula="total_load_kw * 0.55",
            channel_id=f"{station_id}.{gen_prefix}-1.load_kw",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=gen_capacity,
        )
    )
    nodes.append(
        Node(
            id=f"{station_id}.generators.unit2_load_kw",
            domain=TwinDomain.GENERATORS,
            unit="kW",
            description=f"Unit 2 ({gen_prefix.upper()}-2) active output",
            inputs=(f"{station_id}.energy.total_load_kw",),
            relation=_gen2_load,
            formula="total_load_kw * 0.30",
            channel_id=f"{station_id}.{gen_prefix}-2.load_kw",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=gen_capacity,
        )
    )
    nodes.append(
        Node(
            id=f"{station_id}.generators.unit3_load_kw",
            domain=TwinDomain.GENERATORS,
            unit="kW",
            description=f"Unit 3 ({gen_prefix.upper()}-3) active output",
            inputs=(f"{station_id}.energy.total_load_kw",),
            relation=_gen3_load,
            formula="total_load_kw * 0.15",
            channel_id=f"{station_id}.{gen_prefix}-3.load_kw",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=gen_capacity,
        )
    )

    # ---------------- 5. FUEL DOMAIN ----------------
    def _fuel_burn_rate_lph(inputs: Mapping[str, float]) -> float:
        p1 = inputs[f"{station_id}.generators.unit1_load_kw"]
        p2 = inputs[f"{station_id}.generators.unit2_load_kw"]
        p3 = inputs[f"{station_id}.generators.unit3_load_kw"]
        q_heat = inputs[f"{station_id}.heating.demand_kw"]
        
        sfc1 = specific_fuel_consumption((p1 / gen_capacity) * 100.0)
        sfc2 = specific_fuel_consumption((p2 / gen_capacity) * 100.0)
        sfc3 = specific_fuel_consumption((p3 / gen_capacity) * 100.0)
        
        gen_burn_lph = (p1 * sfc1) + (p2 * sfc2) + (p3 * sfc3)
        # Oil-fired boiler thermal fuel (~8.5 kWh_th / L); Bharati CHP recovers waste heat (auxiliary boiler ~30%)
        boiler_eff = 8.5
        heat_burn_lph = (q_heat / boiler_eff) if is_maitri else (0.30 * q_heat / boiler_eff)
        return gen_burn_lph + heat_burn_lph

    nodes.append(
        Node(
            id=f"{station_id}.fuel.burn_rate_lph",
            domain=TwinDomain.FUEL,
            unit="L/h",
            description="Hourly diesel burn rate from all running generators and boilers",
            inputs=(
                f"{station_id}.generators.unit1_load_kw",
                f"{station_id}.generators.unit2_load_kw",
                f"{station_id}.generators.unit3_load_kw",
                f"{station_id}.heating.demand_kw",
            ),
            relation=_fuel_burn_rate_lph,
            formula="Σ(P_gen * SFC) + Q_heat / η_boiler",
            observation_policy="prefer_computed",
            lower=5.0,
            upper=150.0,
        )
    )

    def _fuel_burn_rate_kld(inputs: Mapping[str, float]) -> float:
        lph = inputs[f"{station_id}.fuel.burn_rate_lph"]
        return (lph * 24.0) / 1000.0

    nodes.append(
        Node(
            id=f"{station_id}.fuel.burn_rate_kld",
            domain=TwinDomain.FUEL,
            unit="kL/day",
            description="Daily fuel burn rate in kilolitres per day",
            inputs=(f"{station_id}.fuel.burn_rate_lph",),
            relation=_fuel_burn_rate_kld,
            formula="burn_rate_lph * 24 / 1000",
            observation_policy="prefer_computed",
            lower=0.1,
            upper=3.6,
        )
    )

    # ---------------- 6. INVENTORY DOMAIN ----------------
    nodes.append(
        Node(
            id=f"{station_id}.inventory.tank_a_pct",
            domain=TwinDomain.INVENTORY,
            unit="%",
            description="Fuel Tank A fill level percentage",
            channel_id=f"{station_id}.tank-a.level_pct",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=100.0,
        )
    )
    nodes.append(
        Node(
            id=f"{station_id}.inventory.tank_b_pct",
            domain=TwinDomain.INVENTORY,
            unit="%",
            description="Fuel Tank B fill level percentage",
            channel_id=f"{station_id}.tank-b.level_pct",
            observation_policy="prefer_observed",
            lower=0.0,
            upper=100.0,
        )
    )
    if is_maitri:
        nodes.append(
            Node(
                id=f"{station_id}.inventory.tank_c_pct",
                domain=TwinDomain.INVENTORY,
                unit="%",
                description="Fuel Tank C fill level percentage",
                channel_id=f"{station_id}.tank-c.level_pct",
                observation_policy="prefer_observed",
                lower=0.0,
                upper=100.0,
            )
        )

    def _total_volume_kl(inputs: Mapping[str, float]) -> float:
        ta = inputs[f"{station_id}.inventory.tank_a_pct"]
        tb = inputs[f"{station_id}.inventory.tank_b_pct"]
        if is_maitri:
            tc = inputs[f"{station_id}.inventory.tank_c_pct"]
            return (ta * 1.5) + (tb * 1.5) + (tc * 1.5)
        else:
            return (ta * 1.7) + (tb * 1.7)

    inv_inputs = (
        (f"{station_id}.inventory.tank_a_pct", f"{station_id}.inventory.tank_b_pct", f"{station_id}.inventory.tank_c_pct")
        if is_maitri
        else (f"{station_id}.inventory.tank_a_pct", f"{station_id}.inventory.tank_b_pct")
    )
    nodes.append(
        Node(
            id=f"{station_id}.inventory.total_volume_kl",
            domain=TwinDomain.INVENTORY,
            unit="kL",
            description="Total usable station fuel inventory across bulk tanks",
            inputs=inv_inputs,
            relation=_total_volume_kl,
            formula="Σ(tank_pct * capacity_kl / 100)",
            channel_id=f"{station_id}.fuel-inventory.total_volume_kl",
            observation_policy="prefer_computed",
            lower=0.0,
            upper=coeffs.tank_capacity_kl,
        )
    )

    # ---------------- 7. LOGISTICS DOMAIN ----------------
    def _autonomy_days(inputs: Mapping[str, float]) -> float:
        vol = inputs[f"{station_id}.inventory.total_volume_kl"]
        burn = inputs[f"{station_id}.fuel.burn_rate_kld"]
        if burn <= 0.001:
            return 999.0
        return vol / burn

    nodes.append(
        Node(
            id=f"{station_id}.logistics.days_of_autonomy",
            domain=TwinDomain.LOGISTICS,
            unit="d",
            description="Calculated station autonomy remaining in days at current burn rate",
            inputs=(f"{station_id}.inventory.total_volume_kl", f"{station_id}.fuel.burn_rate_kld"),
            relation=_autonomy_days,
            formula="total_volume_kl / burn_rate_kld",
            channel_id=f"{station_id}.fuel-inventory.days_of_autonomy_d",
            observation_policy="prefer_computed",
            lower=0.0,
            upper=1500.0,
        )
    )

    # ---------------- 8. RISK / CAPACITY DOMAIN ----------------
    def _n_minus_one_margin_pct(inputs: Mapping[str, float]) -> float:
        total_load = inputs[f"{station_id}.energy.total_load_kw"]
        surviving_cap = 2 * gen_capacity
        margin_kw = surviving_cap - total_load
        return (margin_kw / surviving_cap) * 100.0

    nodes.append(
        Node(
            id=f"{station_id}.risk.n_minus_1_margin_pct",
            domain=TwinDomain.RISK,
            unit="%",
            description="N-1 Generation redundancy reserve margin if the largest unit trips",
            inputs=(f"{station_id}.energy.total_load_kw",),
            relation=_n_minus_one_margin_pct,
            formula="(2 * Gen_Cap - Total_Load) / (2 * Gen_Cap) * 100",
            observation_policy="prefer_computed",
            lower=-50.0,
            upper=100.0,
        )
    )

    def _composite_risk_score(inputs: Mapping[str, float]) -> float:
        autonomy = inputs[f"{station_id}.logistics.days_of_autonomy"]
        margin = inputs[f"{station_id}.risk.n_minus_1_margin_pct"]
        risk = 12.0
        if autonomy < 90.0:
            risk += (90.0 - autonomy) * 0.7
        if margin < 25.0:
            risk += max(0.0, (25.0 - margin) * 1.5)
        return min(100.0, max(0.0, risk))

    nodes.append(
        Node(
            id=f"{station_id}.risk.composite_score",
            domain=TwinDomain.RISK,
            unit="index",
            description="Deterministic composite operational risk index (0..100)",
            inputs=(f"{station_id}.logistics.days_of_autonomy", f"{station_id}.risk.n_minus_1_margin_pct"),
            relation=_composite_risk_score,
            formula="f(autonomy, n_minus_1_margin)",
            observation_policy="prefer_computed",
            lower=0.0,
            upper=100.0,
        )
    )

    return DependencyGraph(
        graph_id=f"{station_id}-causal-dag",
        model_version=MODEL_VERSION,
        nodes=nodes,
    )
