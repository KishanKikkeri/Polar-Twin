"""Phase 4A vocabulary: runtime, ingestion, alerts, events, security, audit.

Like ``app.domain.enums`` these values are part of the public contract
(docs/phase4/agent4a-contracts.md). Changing a value is a breaking change.
"""

from enum import StrEnum


class TwinDomain(StrEnum):
    """Causal chain domains, in propagation order."""

    ENVIRONMENT = "ENVIRONMENT"
    HEATING = "HEATING"
    ENERGY = "ENERGY"
    GENERATORS = "GENERATORS"
    FUEL = "FUEL"
    INVENTORY = "INVENTORY"
    LOGISTICS = "LOGISTICS"
    RISK = "RISK"


class NodeSource(StrEnum):
    """How a dependency-graph node got its value in one evaluation."""

    OBSERVED = "OBSERVED"
    """Taken from telemetry (or a supplied input) without recomputation."""
    COMPUTED = "COMPUTED"
    """Computed by the node's relation from its inputs."""
    UNKNOWN = "UNKNOWN"
    """Could not be computed because at least one input was unavailable."""
    MISSING = "MISSING"
    """An exogenous input with no observation and no relation."""


# ---- ingestion -------------------------------------------------------------


class IngestOutcome(StrEnum):
    ACCEPTED = "ACCEPTED"
    DUPLICATE = "DUPLICATE"
    """Exact replay of an already-ingested event (same id or same natural key + value). Dropped."""
    CONFLICT = "CONFLICT"
    """Same natural key as an ingested event but a different value. Rejected, never overwrites."""
    REJECTED = "REJECTED"
    """Failed validation."""


class Ordering(StrEnum):
    IN_ORDER = "IN_ORDER"
    OUT_OF_ORDER = "OUT_OF_ORDER"
    """Older than the channel's latest ingested observation. Stored in history; never regresses current state."""


class Timeliness(StrEnum):
    ON_TIME = "ON_TIME"
    DELAYED = "DELAYED"
    """Arrived later than ``ingest_delayed_after_seconds`` after it was observed (e.g. store-and-forward replay)."""


class RejectReason(StrEnum):
    UNKNOWN_CHANNEL = "UNKNOWN_CHANNEL"
    TOPOLOGY_MISMATCH = "TOPOLOGY_MISMATCH"
    UNIT_MISMATCH = "UNIT_MISMATCH"
    NON_FINITE_VALUE = "NON_FINITE_VALUE"
    QUALITY_VALUE_MISMATCH = "QUALITY_VALUE_MISMATCH"
    FUTURE_TIMESTAMP = "FUTURE_TIMESTAMP"
    TOO_LATE = "TOO_LATE"
    PROVENANCE_NOT_ALLOWED = "PROVENANCE_NOT_ALLOWED"
    MALFORMED = "MALFORMED"
    STATION_FORBIDDEN = "STATION_FORBIDDEN"


# ---- alerts & events -------------------------------------------------------


class AlertSeverity(StrEnum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


SEVERITY_RANK = {AlertSeverity.INFO: 0, AlertSeverity.WARNING: 1, AlertSeverity.CRITICAL: 2}


class AlertState(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


ACTIVE_ALERT_STATES = frozenset({AlertState.OPEN, AlertState.ACKNOWLEDGED})


class AlertSource(StrEnum):
    THRESHOLD = "THRESHOLD"
    """A channel crossed its configured warn/crit limits."""
    DATA_QUALITY = "DATA_QUALITY"
    """Telemetry stale/missing for a channel."""
    DEPENDENCY = "DEPENDENCY"
    """A rule over dependency-graph outputs (capacity margin, autonomy, N-1...)."""
    INGESTION = "INGESTION"
    """Ingestion/link problems (conflicts, link down)."""


class EventType(StrEnum):
    ALERT_RAISED = "ALERT_RAISED"
    ALERT_ESCALATED = "ALERT_ESCALATED"
    ALERT_DEESCALATED = "ALERT_DEESCALATED"
    ALERT_ACKNOWLEDGED = "ALERT_ACKNOWLEDGED"
    ALERT_RESOLVED = "ALERT_RESOLVED"
    TELEMETRY_GAP_OPENED = "TELEMETRY_GAP_OPENED"
    TELEMETRY_GAP_CLOSED = "TELEMETRY_GAP_CLOSED"
    TELEMETRY_CONFLICT = "TELEMETRY_CONFLICT"
    LINK_DOWN = "LINK_DOWN"
    LINK_UP = "LINK_UP"
    BUFFER_FLUSHED = "BUFFER_FLUSHED"
    BUFFER_OVERFLOW = "BUFFER_OVERFLOW"
    RUNTIME_STARTED = "RUNTIME_STARTED"
    RUNTIME_STOPPED = "RUNTIME_STOPPED"
    PERTURBATION_APPLIED = "PERTURBATION_APPLIED"
    PERTURBATION_CLEARED = "PERTURBATION_CLEARED"


# ---- security --------------------------------------------------------------


class Role(StrEnum):
    VIEWER = "VIEWER"
    """Read-only access to twin state, telemetry, alerts."""
    STATION_OPERATOR = "STATION_OPERATOR"
    """Station crew/engineer: reads and acknowledges alerts for their assigned station(s) only."""
    HQ_MOES = "HQ_MOES"
    """NCPOR/MoES headquarters: all stations, alert acknowledgement, audit read."""
    SYSTEM_ADMIN = "SYSTEM_ADMIN"
    """Platform administrator: runtime control and fault injection."""


class Permission(StrEnum):
    TWIN_READ = "twin:read"
    TELEMETRY_READ = "telemetry:read"
    TELEMETRY_INGEST = "telemetry:ingest"
    ALERTS_READ = "alerts:read"
    ALERTS_ACKNOWLEDGE = "alerts:acknowledge"
    RUNTIME_READ = "runtime:read"
    RUNTIME_CONTROL = "runtime:control"
    PERTURBATION_APPLY = "perturbation:apply"
    AUDIT_READ = "audit:read"


class AuditOutcome(StrEnum):
    SUCCESS = "SUCCESS"
    DENIED = "DENIED"
    FAILURE = "FAILURE"
