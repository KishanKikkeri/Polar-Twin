"""Raw, append-only telemetry readings.

This table is never updated by the twin. Aggregated / current twin state is a
*read model* computed from it (see ``app.services.twin_service``), so raw
observations, predictions and simulations coexist without overwriting each
other.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utcnow
from app.db.base import Base, UTCDateTime, str_enum
from app.domain.enums import Provenance, Quality


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"
    __table_args__ = (
        # A MISSING sample never carries a value; every other sample must.
        # This makes "missing silently became 0" impossible at the storage level.
        CheckConstraint(
            "(quality = 'MISSING' AND value IS NULL) OR (quality <> 'MISSING' AND value IS NOT NULL)",
            name="value_matches_quality",
        ),
        Index("ix_telemetry_readings_channel_observed", "channel_id", "observed_at"),
        Index("ix_telemetry_readings_station_observed", "station_id", "observed_at"),
        # Natural key for duplicate detection. Includes observed_at (the
        # TimescaleDB partitioning column) so it stays valid on a hypertable.
        Index(
            "uq_telemetry_readings_natural_key",
            "channel_id", "observed_at", "provenance", "source",
            unique=True,
        ),
        Index("ix_telemetry_readings_event_id", "event_id"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("telemetry_channels.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalised for efficient filtering; always consistent with channel_id
    # (enforced by the repository on insert).
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.id", ondelete="CASCADE"), nullable=False
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric: Mapped[str] = mapped_column(String(64), nullable=False)

    observed_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, comment="When the value applies (for predictions: the target time)"
    )
    ingested_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utcnow)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    provenance: Mapped[Provenance] = mapped_column(str_enum(Provenance, "provenance"), nullable=False)
    quality: Mapped[Quality] = mapped_column(str_enum(Quality, "quality"), nullable=False)
    source: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="Producer identifier, e.g. 'seed:synthetic-v1'"
    )
    # ---- Phase 4A ingestion metadata (nullable: seed/legacy rows have none) ----
    event_id: Mapped[str | None] = mapped_column(
        String(96), nullable=True, comment="Producer-assigned idempotency key (TelemetryEvent.event_id)"
    )
    ingest_flags: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="Comma-separated: OUT_OF_ORDER, DELAYED, GAP_MARKER"
    )
