"""Runtime persistence: alerts (with lifecycle), twin events, audit trail."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utcnow
from app.db.base import Base, UTCDateTime, str_enum
from app.domain.runtime_enums import AlertSeverity, AlertSource, AlertState, AuditOutcome, EventType, TwinDomain


class TwinAlert(Base):
    """One alert *instance*: raised when a rule fires, resolved when it clears.

    ``dedup_key`` identifies the condition (rule + subject). At most one active
    (OPEN/ACKNOWLEDGED) alert exists per dedup_key; this is enforced by the
    alert engine (a partial unique index is not portable to SQLite).
    """

    __tablename__ = "twin_alerts"
    __table_args__ = (
        Index("ix_twin_alerts_station_state", "station_id", "state"),
        Index("ix_twin_alerts_dedup_key", "dedup_key"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    station_id: Mapped[str] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"), nullable=False)
    rule_id: Mapped[str] = mapped_column(String(96), nullable=False)
    dedup_key: Mapped[str] = mapped_column(String(256), nullable=False)
    severity: Mapped[AlertSeverity] = mapped_column(str_enum(AlertSeverity, "alert_severity"), nullable=False)
    state: Mapped[AlertState] = mapped_column(str_enum(AlertState, "alert_state"), nullable=False)
    source: Mapped[AlertSource] = mapped_column(str_enum(AlertSource, "alert_source"), nullable=False)
    domain: Mapped[TwinDomain | None] = mapped_column(str_enum(TwinDomain, "twin_domain"), nullable=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str | None] = mapped_column(Text)
    asset_id: Mapped[str | None] = mapped_column(String(128))
    channel_id: Mapped[str | None] = mapped_column(String(160))
    node_id: Mapped[str | None] = mapped_column(String(128))
    value: Mapped[float | None] = mapped_column(Float)
    threshold: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(24))
    evidence_provenance: Mapped[str | None] = mapped_column(
        String(32), comment="Provenance of the data the rule evaluated (e.g. SYNTHETIC)"
    )
    evidence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    raised_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    last_evaluated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    acknowledged_by: Mapped[str | None] = mapped_column(String(128))
    acknowledgement_note: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    occurrences: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    clear_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class TwinEvent(Base):
    """Append-only operational event log (alerts lifecycle, gaps, link state, runtime control)."""

    __tablename__ = "twin_events"
    __table_args__ = (Index("ix_twin_events_station_ts", "station_id", "occurred_at"),)

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, comment="Simulation/twin time")
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utcnow)
    station_id: Mapped[str | None] = mapped_column(String(32))
    event_type: Mapped[EventType] = mapped_column(str_enum(EventType, "event_type"), nullable=False)
    severity: Mapped[AlertSeverity] = mapped_column(str_enum(AlertSeverity, "event_severity"), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    alert_id: Mapped[str | None] = mapped_column(String(64))
    asset_id: Mapped[str | None] = mapped_column(String(128))
    channel_id: Mapped[str | None] = mapped_column(String(160))
    actor: Mapped[str | None] = mapped_column(String(128))
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class AuditEvent(Base):
    """Tamper-evident audit trail: each row hashes its content plus the previous row's hash."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_occurred", "occurred_at"),)

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_roles: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(160))
    station_id: Mapped[str | None] = mapped_column(String(32))
    outcome: Mapped[AuditOutcome] = mapped_column(str_enum(AuditOutcome, "audit_outcome"), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64))
    client_ip: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), nullable=False)
