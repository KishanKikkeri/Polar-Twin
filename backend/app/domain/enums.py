"""Shared domain vocabulary for the POLARTWIN API contract.

These enums are the single source of truth for both the database layer
(stored as portable VARCHAR + CHECK constraints) and the public API schemas.
Changing a value here is a breaking API change.
"""

from enum import StrEnum


class Provenance(StrEnum):
    """Where a telemetry value came from. Always explicit — never inferred."""

    REAL_OBSERVATION = "REAL_OBSERVATION"
    """Measured by a physical sensor at a station. None exist in this build."""
    SYNTHETIC = "SYNTHETIC"
    """Generated stand-in for an observation (development / demo data)."""
    DERIVED = "DERIVED"
    """Computed deterministically from other observation-class values."""
    PREDICTED = "PREDICTED"
    """Model forecast. Never used as current state."""
    SIMULATED = "SIMULATED"
    """Output of a physics/process simulation. Never used as current state."""
    SCENARIO = "SCENARIO"
    """What-if scenario output. Never used as current state."""


# Provenances allowed to represent the *current* state of the twin.
# SYNTHETIC is included because it is the explicit stand-in for observations
# while no real station feed exists; it is always labelled as such.
OBSERVED_STATE_PROVENANCES: frozenset[Provenance] = frozenset(
    {Provenance.REAL_OBSERVATION, Provenance.SYNTHETIC, Provenance.DERIVED}
)

# Provenances that describe hypothetical / future state. These are stored and
# queryable but must never overwrite or substitute observed state.
NON_OBSERVED_PROVENANCES: frozenset[Provenance] = frozenset(
    {Provenance.PREDICTED, Provenance.SIMULATED, Provenance.SCENARIO}
)


class Quality(StrEnum):
    """Quality flag attached to every raw reading."""

    GOOD = "GOOD"
    SUSPECT = "SUSPECT"
    """Value present but failed a plausibility check / sensor flagged it."""
    BAD = "BAD"
    """Value present but known to be wrong; do not use for decisions."""
    MISSING = "MISSING"
    """An expected sample did not arrive. ``value`` is always null."""


class Freshness(StrEnum):
    """Freshness of a channel's latest observed-state value at ``as_of``."""

    FRESH = "FRESH"
    STALE = "STALE"
    """Last value is older than the channel's ``stale_after_seconds``."""
    MISSING = "MISSING"
    """No usable value: never reported, or the latest record is a MISSING gap."""


class Condition(StrEnum):
    """Operating condition of a channel/asset/station from thresholds."""

    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"
    """No usable value to evaluate (missing, BAD quality, or no thresholds hit-testable)."""


class DataCompleteness(StrEnum):
    """Roll-up of channel freshness for an asset or station."""

    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    NO_DATA = "NO_DATA"


class SystemType(StrEnum):
    """Station infrastructure systems (aligned with frontend dashboard types)."""

    ELECTRICITY = "ELECTRICITY"
    FUEL = "FUEL"
    WATER = "WATER"
    HEATING = "HEATING"
    COMMUNICATION = "COMMUNICATION"
    WASTE = "WASTE"
    ENVIRONMENT = "ENVIRONMENT"
    WEATHER = "WEATHER"


class AssetType(StrEnum):
    GENERATOR = "GENERATOR"
    ELECTRICAL_BUS = "ELECTRICAL_BUS"
    FUEL_TANK = "FUEL_TANK"
    FUEL_INVENTORY = "FUEL_INVENTORY"
    WATER_TANK = "WATER_TANK"
    PUMP = "PUMP"
    DESALINATION_UNIT = "DESALINATION_UNIT"
    HEATING_UNIT = "HEATING_UNIT"
    COMMS_LINK = "COMMS_LINK"
    WASTE_UNIT = "WASTE_UNIT"
    ENVIRONMENT_SENSOR = "ENVIRONMENT_SENSOR"
    WEATHER_STATION = "WEATHER_STATION"


class BuildingCategory(StrEnum):
    """Mirrors the ``type`` field used by the frontend station layouts."""

    BUILDING = "building"
    CONTAINER = "container"
    LAB = "lab"
    ELECTRICITY = "electricity"
    HEATING = "heating"
    COMMS = "comms"
    WATER = "water"
    FUEL = "fuel"
    WASTE = "waste"
    PAD = "pad"
