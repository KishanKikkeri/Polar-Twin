"""Seed catalog: static topology for Maitri and Bharati.

Station metadata and building layout mirror the frontend registry in
``src/data/stations/{maitri,bharati}.js`` so IDs line up (building ``code``
== frontend object ``id``). Baseline magnitudes follow the frontend's
``src/data/infra/index.js`` STATION_SCALE so both layers tell the same story.

Assets and channels are a *plausible engineering model* for a hackathon
prototype — not an inventory of actual station equipment.
"""

from dataclasses import dataclass, field

from app.domain.enums import AssetType, BuildingCategory, SystemType


@dataclass(frozen=True)
class ChannelSpec:
    metric: str
    unit: str
    description: str
    base: float
    interval_s: int = 900
    noise: float = 0.0
    diurnal: float = 0.0  # amplitude of a 24h sine
    drift_per_day: float = 0.0
    decimals: int = 2
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None
    stale_factor: int = 3  # stale_after = interval * factor
    # Demonstration behaviours (all explicit, all documented in HANDOVER.md)
    never_reports: bool = False
    stops_reporting_hours_ago: float | None = None
    missing_windows_hours_ago: tuple[tuple[float, float], ...] = ()
    suspect_spike_every: int | None = None
    simulated_overlay: bool = False  # also emit SIMULATED readings at the same timestamps


@dataclass(frozen=True)
class DerivedSpec:
    """A DERIVED channel computed as Σ(input × weight) over aligned timestamps."""

    metric: str
    unit: str
    description: str
    inputs: tuple[tuple[str, str, float], ...]  # (asset_code, metric, weight)
    interval_s: int = 900
    decimals: int = 2
    warn_low: float | None = None
    warn_high: float | None = None
    crit_low: float | None = None
    crit_high: float | None = None
    stale_factor: int = 3
    predict_hours: int = 0  # emit hourly PREDICTED values this far ahead
    predict_rate_per_day: float = 0.0  # linear depletion used by the toy forecaster


@dataclass(frozen=True)
class AssetSpec:
    code: str
    name: str
    asset_type: AssetType
    system: SystemType
    building_code: str | None
    channels: tuple[ChannelSpec | DerivedSpec, ...]
    description: str | None = None


@dataclass(frozen=True)
class BuildingSpec:
    code: str
    name: str
    subtitle: str
    category: BuildingCategory
    position: tuple[float, float, float]
    size: tuple[float, float, float]


@dataclass(frozen=True)
class StationSpec:
    id: str
    name: str
    short_name: str
    location: str
    region: str
    operator: str
    purpose: str
    established_year: int
    latitude: float
    longitude: float
    buildings: tuple[BuildingSpec, ...]
    assets: tuple[AssetSpec, ...] = field(default_factory=tuple)


B = BuildingCategory
S = SystemType
A = AssetType

NCPOR = "National Centre for Polar and Ocean Research (NCPOR)"


def _common_env_assets(main_temp: float, lab_temp: float, lab_humidity_missing: bool) -> tuple[AssetSpec, ...]:
    return (
        AssetSpec(
            "indoor-env-main", "Main Building Indoor Environment", A.ENVIRONMENT_SENSOR, S.ENVIRONMENT,
            "main-building",
            (
                ChannelSpec("air_temp_c", "degC", "Indoor air temperature", main_temp, noise=0.25, diurnal=0.6,
                            warn_low=16, crit_low=12, warn_high=27, crit_high=30, decimals=1),
                ChannelSpec("co2_ppm", "ppm", "Indoor CO2 concentration", 680, noise=40, diurnal=120,
                            warn_high=1200, crit_high=2000, decimals=0),
            ),
        ),
        AssetSpec(
            "indoor-env-lab", "Laboratory Indoor Environment", A.ENVIRONMENT_SENSOR, S.ENVIRONMENT, "laboratory",
            (
                ChannelSpec("air_temp_c", "degC", "Lab air temperature", lab_temp, noise=0.2, diurnal=0.4,
                            warn_low=16, crit_low=12, warn_high=26, crit_high=30, decimals=1),
                ChannelSpec("humidity_pct", "%", "Lab relative humidity", 37, noise=1.5,
                            warn_low=20, warn_high=60, decimals=0, never_reports=lab_humidity_missing),
            ),
        ),
    )


MAITRI = StationSpec(
    id="maitri",
    name="Maitri Research Station",
    short_name="Maitri",
    location="Schirmacher Oasis, Queen Maud Land, Antarctica",
    region="Central Dronning Maud Land",
    operator=NCPOR,
    purpose=(
        "Year-round scientific research station supporting glaciology, atmospheric science, biology and "
        "geophysics research, and logistics for India's Antarctic programme."
    ),
    established_year=1989,
    latitude=-70.7653,
    longitude=11.7358,
    buildings=(
        BuildingSpec("main-building", "Main Station Building", "Command, quarters & mess — elevated dogleg block", B.BUILDING, (9, 0, -10.8), (34, 4.2, 7)),
        BuildingSpec("container-yard", "Container Yard", "Orange containerized modules — storage & auxiliary units", B.CONTAINER, (-25, 0, -13.5), (3, 2.6, 6)),
        BuildingSpec("container-annex", "Container Annex", "Additional storage container", B.CONTAINER, (-10.8, 0, 12.6), (2.6, 2.4, 5)),
        BuildingSpec("workshop", "Workshop", "Engineering & maintenance building", B.BUILDING, (-15, 0, -16), (8, 3, 6)),
        BuildingSpec("laboratory", "Laboratory", "Science & analysis wing", B.LAB, (0, 0, -20), (9, 3.2, 6)),
        BuildingSpec("power-house", "Power House", "Generators & switchgear — beside the meltwater pond", B.ELECTRICITY, (10, 0, -20), (6, 3, 5)),
        BuildingSpec("heating-plant", "Heating Plant", "Central heating system", B.HEATING, (18, 0, -22), (3.8, 2.6, 3.8)),
        BuildingSpec("comms-tower", "Communication Mast", "Satellite & radio link — near the main building corner", B.COMMS, (15, 0, -4), (1, 13, 1)),
        BuildingSpec("water-pump-house", "Lake Water Pump House", "Freshwater intake at the frozen lake edge", B.WATER, (-34, 0, -18), (5, 2.8, 4)),
        BuildingSpec("fuel-farm", "Fuel Farm", "Bulk fuel storage", B.FUEL, (-32, 0, 14), (3.2, 5, 3.2)),
        BuildingSpec("fuel-station", "Fuel Station", "Dispensing point", B.FUEL, (-26, 0, 16), (2.4, 2.4, 2.4)),
        BuildingSpec("summer-camp", "Summer Camp", "Seasonal accommodation", B.BUILDING, (40, 0, -12), (16, 3, 6)),
        BuildingSpec("incinerator", "Waste / Incinerator Area", "Waste processing", B.WASTE, (22, 0, 20), (6, 3, 5)),
        BuildingSpec("helipad-1", "Helipad 1", "Primary landing pad", B.PAD, (44, 0, 18), (9, 0.1, 9)),
        BuildingSpec("helipad-2", "Helipad 2", "Secondary landing pad", B.PAD, (46, 0, -22), (9, 0.1, 9)),
    ),
    assets=(
        AssetSpec("dg-1", "Diesel Generator DG-1", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "Generator electrical output", 45, noise=2.5, diurnal=6, warn_high=130, crit_high=150, decimals=1),)),
        AssetSpec("dg-2", "Diesel Generator DG-2", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "Generator electrical output", 12, noise=1.5, diurnal=2, warn_high=130, crit_high=150, decimals=1),)),
        AssetSpec("dg-3", "Diesel Generator DG-3", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "Generator electrical output", 25, noise=2.0, diurnal=4, warn_high=130, crit_high=150, decimals=1),)),
        AssetSpec("power-bus", "Main LV Bus", A.ELECTRICAL_BUS, S.ELECTRICITY, "power-house", (
            DerivedSpec("station_load_kw", "kW", "Total station load = Σ generator outputs",
                        (("dg-1", "load_kw", 1.0), ("dg-2", "load_kw", 1.0), ("dg-3", "load_kw", 1.0)), decimals=1),
            ChannelSpec("voltage_v", "V", "Bus line voltage", 415, noise=1.8, warn_low=395, warn_high=435, crit_low=380, crit_high=440, decimals=1),
            ChannelSpec("frequency_hz", "Hz", "Bus frequency", 50.0, noise=0.04, warn_low=49.5, warn_high=50.5, crit_low=49.0, crit_high=51.0, decimals=2),
        )),
        AssetSpec("tank-a", "Fuel Tank A", A.FUEL_TANK, S.FUEL, "fuel-farm",
                  (ChannelSpec("level_pct", "%", "Tank fill level (150 kL capacity)", 72.0, noise=0.05, drift_per_day=-0.4, warn_low=25, crit_low=10),)),
        AssetSpec("tank-b", "Fuel Tank B", A.FUEL_TANK, S.FUEL, "fuel-farm",
                  (ChannelSpec("level_pct", "%", "Tank fill level (150 kL capacity)", 68.0, noise=0.05, drift_per_day=-0.4, warn_low=25, crit_low=10),)),
        AssetSpec("tank-c", "Fuel Tank C", A.FUEL_TANK, S.FUEL, "fuel-farm",
                  (ChannelSpec("level_pct", "%", "Tank fill level (150 kL capacity)", 77.0, noise=0.05, drift_per_day=-0.4, warn_low=25, crit_low=10),)),
        AssetSpec("fuel-inventory", "Fuel Farm Inventory", A.FUEL_INVENTORY, S.FUEL, "fuel-farm", (
            DerivedSpec("total_volume_kl", "kL", "Σ tank level × capacity",
                        (("tank-a", "level_pct", 1.5), ("tank-b", "level_pct", 1.5), ("tank-c", "level_pct", 1.5)),
                        predict_hours=24, predict_rate_per_day=1.8),
            DerivedSpec("days_of_autonomy_d", "d", "Inventory ÷ nominal burn rate (1.8 kL/day)",
                        (("fuel-inventory", "total_volume_kl", 1 / 1.8),), decimals=1, warn_low=90, crit_low=30),
        ), description="Derived roll-up of the bulk fuel tanks."),
        AssetSpec("pump-1", "Lake Intake Pump P-1", A.PUMP, S.WATER, "water-pump-house",
                  (ChannelSpec("flow_lpm", "L/min", "Intake flow rate", 40, noise=2.0, diurnal=6, warn_low=10, crit_low=2, decimals=1),)),
        AssetSpec("water-tank", "Freshwater Storage Tank", A.WATER_TANK, S.WATER, "water-pump-house",
                  (ChannelSpec("level_pct", "%", "Tank fill level (60,000 L capacity)", 84, noise=0.4, diurnal=2, warn_low=30, crit_low=15, decimals=1),)),
        AssetSpec("boiler-1", "Central Heating Boiler", A.HEATING_UNIT, S.HEATING, "heating-plant", (
            ChannelSpec("supply_temp_c", "degC", "Heating loop supply temperature", 70, noise=0.8, diurnal=2,
                        warn_low=55, crit_low=45, warn_high=90, crit_high=95, decimals=1, simulated_overlay=True),
            ChannelSpec("load_pct", "%", "Boiler firing load", 68, noise=2, diurnal=6, warn_high=95, decimals=0),
        )),
        AssetSpec("satcom-1", "Satellite Link", A.COMMS_LINK, S.COMMUNICATION, "comms-tower", (
            ChannelSpec("latency_ms", "ms", "Round-trip latency to mainland gateway", 620, noise=35,
                        warn_high=1200, crit_high=2500, decimals=0, missing_windows_hours_ago=((6.0, 5.0),)),
            ChannelSpec("bandwidth_mbps", "Mbit/s", "Available link bandwidth", 17, noise=1.5,
                        warn_low=4, crit_low=1, decimals=1, missing_windows_hours_ago=((6.0, 5.0),)),
        )),
        AssetSpec("incinerator-1", "Incinerator Feed Store", A.WASTE_UNIT, S.WASTE, "incinerator",
                  (ChannelSpec("storage_pct", "%", "Waste awaiting processing, % of store", 35, noise=0.5, drift_per_day=1.5, warn_high=80, crit_high=95, decimals=0),)),
        AssetSpec("aws-1", "Automatic Weather Station", A.WEATHER_STATION, S.WEATHER, None, (
            ChannelSpec("air_temp_c", "degC", "Outdoor air temperature", -11, interval_s=600, noise=0.6, diurnal=3, decimals=1),
            ChannelSpec("wind_speed_ms", "m/s", "10 m wind speed", 8, interval_s=600, noise=1.8, diurnal=2,
                        warn_high=25, crit_high=35, decimals=1, suspect_spike_every=37),
        ), description="Station-level met mast (not tied to a building)."),
    )
    + _common_env_assets(main_temp=21.2, lab_temp=20.2, lab_humidity_missing=True),
)


BHARATI = StationSpec(
    id="bharati",
    name="Bharati Research Station",
    short_name="Bharati",
    location="Larsemann Hills, Prydz Bay, East Antarctica",
    region="North Grovnes Island, between Thala Fjord and Quilty Bay",
    operator=NCPOR,
    purpose=(
        "India's third Antarctic station, focused on oceanography, geology and continental-breakup research; "
        "supports year-round crew with a modular, container-based build."
    ),
    established_year=2012,
    latitude=-69.4082,
    longitude=76.1874,
    buildings=(
        BuildingSpec("main-building", "Main Multi-Purpose Building", "Quarters, mess & command", B.BUILDING, (0, 0, 0), (30, 4.6, 8)),
        BuildingSpec("laboratory", "Science Container Lab", "Oceanography & geology lab", B.LAB, (16, 0, 10), (9, 3, 6)),
        BuildingSpec("satellite-camp", "Satellite Camp", "Overflow accommodation", B.BUILDING, (-20, 0, 12), (13, 2.8, 6)),
        BuildingSpec("container-modules", "Container Modules", "Storage & auxiliary units", B.CONTAINER, (-2, 0, -14), (3, 2.6, 6)),
        BuildingSpec("fuel-farm", "Fuel Farm", "Bulk fuel storage", B.FUEL, (-28, 0, -10), (3, 4.4, 3)),
        BuildingSpec("fuel-station", "Fuel Station", "Dispensing point", B.FUEL, (-20, 0, -12), (2.2, 2.2, 2.2)),
        BuildingSpec("ro-plant", "Desalination / RO Plant", "Seawater intake & treatment", B.WATER, (24, 0, -8), (5, 2.6, 4)),
        BuildingSpec("wastewater-plant", "Wastewater Treatment Plant", "Blackwater / greywater processing", B.WASTE, (10, 0, -18), (5.5, 2.8, 5)),
        BuildingSpec("comms-tower", "Communication Mast", "Satellite & radio link", B.COMMS, (4, 0, 8), (1, 13, 1)),
        BuildingSpec("power-house", "CHP Power House", "Diesel combined heat & power units", B.ELECTRICITY, (-8, 0, -4), (6.5, 3, 5)),
        BuildingSpec("heating-plant", "Heating Distribution Unit", "CHP waste-heat recovery", B.HEATING, (-14, 0, 2), (3.6, 2.4, 3.6)),
        BuildingSpec("helipad-1", "Bharati Heliport", "Primary landing pad", B.PAD, (34, 0, 18), (9, 0.1, 9)),
    ),
    assets=(
        AssetSpec("chp-1", "CHP Unit 1", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "CHP electrical output", 30, noise=2.0, diurnal=5, warn_high=110, crit_high=125, decimals=1),)),
        AssetSpec("chp-2", "CHP Unit 2", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "CHP electrical output", 18, noise=1.5, diurnal=3, warn_high=110, crit_high=125, decimals=1),)),
        AssetSpec("chp-3", "CHP Unit 3", A.GENERATOR, S.ELECTRICITY, "power-house",
                  (ChannelSpec("load_kw", "kW", "CHP electrical output", 20, noise=1.5, diurnal=3, warn_high=110, crit_high=125, decimals=1),)),
        AssetSpec("power-bus", "Main LV Bus", A.ELECTRICAL_BUS, S.ELECTRICITY, "power-house", (
            DerivedSpec("station_load_kw", "kW", "Total station load = Σ CHP outputs",
                        (("chp-1", "load_kw", 1.0), ("chp-2", "load_kw", 1.0), ("chp-3", "load_kw", 1.0)), decimals=1),
            ChannelSpec("voltage_v", "V", "Bus line voltage", 415, noise=1.8, warn_low=395, warn_high=435, crit_low=380, crit_high=440, decimals=1),
            ChannelSpec("frequency_hz", "Hz", "Bus frequency", 50.0, noise=0.04, warn_low=49.5, warn_high=50.5, crit_low=49.0, crit_high=51.0, decimals=2),
        )),
        AssetSpec("tank-a", "Fuel Tank A", A.FUEL_TANK, S.FUEL, "fuel-farm",
                  (ChannelSpec("level_pct", "%", "Tank fill level (170 kL capacity)", 64.0, noise=0.05, drift_per_day=-0.44, warn_low=25, crit_low=10),)),
        AssetSpec("tank-b", "Fuel Tank B", A.FUEL_TANK, S.FUEL, "fuel-farm",
                  (ChannelSpec("level_pct", "%", "Tank fill level (170 kL capacity)", 62.0, noise=0.05, drift_per_day=-0.44, warn_low=25, crit_low=10),)),
        AssetSpec("fuel-inventory", "Fuel Farm Inventory", A.FUEL_INVENTORY, S.FUEL, "fuel-farm", (
            DerivedSpec("total_volume_kl", "kL", "Σ tank level × capacity",
                        (("tank-a", "level_pct", 1.7), ("tank-b", "level_pct", 1.7)),
                        predict_hours=24, predict_rate_per_day=1.5),
            DerivedSpec("days_of_autonomy_d", "d", "Inventory ÷ nominal burn rate (1.5 kL/day)",
                        (("fuel-inventory", "total_volume_kl", 1 / 1.5),), decimals=1, warn_low=90, crit_low=30),
        ), description="Derived roll-up of the bulk fuel tanks."),
        AssetSpec("ro-unit-1", "RO Desalination Unit", A.DESALINATION_UNIT, S.WATER, "ro-plant",
                  (ChannelSpec("output_lph", "L/h", "Permeate output", 300, noise=8, warn_low=150, crit_low=60, decimals=0,
                               stops_reporting_hours_ago=3.0),)),
        AssetSpec("water-tank", "Freshwater Storage Tank", A.WATER_TANK, S.WATER, "ro-plant",
                  (ChannelSpec("level_pct", "%", "Tank fill level (42,000 L capacity)", 76, noise=0.4, diurnal=2, warn_low=30, crit_low=15, decimals=1),)),
        AssetSpec("heat-exchanger-1", "CHP Heat Recovery Exchanger", A.HEATING_UNIT, S.HEATING, "heating-plant", (
            ChannelSpec("supply_temp_c", "degC", "Heating loop supply temperature", 65, noise=0.8, diurnal=2,
                        warn_low=55, crit_low=45, warn_high=90, crit_high=95, decimals=1),
            ChannelSpec("load_pct", "%", "Heat demand vs capacity", 60, noise=2, diurnal=6, warn_high=95, decimals=0),
        )),
        AssetSpec("satcom-1", "Satellite Link", A.COMMS_LINK, S.COMMUNICATION, "comms-tower", (
            ChannelSpec("latency_ms", "ms", "Round-trip latency to mainland gateway", 580, noise=30, warn_high=1200, crit_high=2500, decimals=0),
            ChannelSpec("bandwidth_mbps", "Mbit/s", "Available link bandwidth", 15, noise=1.2, warn_low=4, crit_low=1, decimals=1),
        )),
        AssetSpec("wwtp-1", "Wastewater Treatment Unit", A.WASTE_UNIT, S.WASTE, "wastewater-plant",
                  (ChannelSpec("buffer_tank_pct", "%", "Effluent buffer tank level", 82.5, noise=0.3, drift_per_day=2.0, warn_high=80, crit_high=95, decimals=1),)),
        AssetSpec("aws-1", "Automatic Weather Station", A.WEATHER_STATION, S.WEATHER, None, (
            ChannelSpec("air_temp_c", "degC", "Outdoor air temperature", -13, interval_s=600, noise=0.6, diurnal=2.5, decimals=1),
            ChannelSpec("wind_speed_ms", "m/s", "10 m wind speed", 10, interval_s=600, noise=2.0, diurnal=2, warn_high=25, crit_high=35, decimals=1),
        ), description="Station-level met mast (not tied to a building)."),
    )
    + _common_env_assets(main_temp=21.0, lab_temp=19.8, lab_humidity_missing=False),
)

STATIONS: tuple[StationSpec, ...] = (MAITRI, BHARATI)
