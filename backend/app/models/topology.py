"""Static twin topology: stations, buildings, assets and telemetry channels."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timeutil import utcnow
from app.db.base import Base, UTCDateTime, str_enum
from app.domain.enums import AssetType, BuildingCategory, SystemType


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class Station(TimestampMixin, Base):
    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, comment="Stable slug, e.g. 'maitri'")
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    short_name: Mapped[str] = mapped_column(String(64), nullable=False)
    location: Mapped[str] = mapped_column(String(256), nullable=False)
    region: Mapped[str | None] = mapped_column(String(256))
    operator: Mapped[str] = mapped_column(String(256), nullable=False)
    purpose: Mapped[str | None] = mapped_column(Text)
    established_year: Mapped[int | None] = mapped_column(Integer)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    buildings: Mapped[list["Building"]] = relationship(
        back_populates="station", order_by="Building.code", cascade="all, delete-orphan"
    )
    assets: Mapped[list["Asset"]] = relationship(
        back_populates="station", order_by="Asset.code", cascade="all, delete-orphan"
    )


class Building(TimestampMixin, Base):
    __tablename__ = "buildings"
    __table_args__ = (UniqueConstraint("station_id", "code", name="uq_buildings_station_code"),)

    id: Mapped[str] = mapped_column(String(96), primary_key=True, comment="'<station>.<code>'")
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="Matches frontend object id, e.g. 'power-house'"
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(256))
    category: Mapped[BuildingCategory] = mapped_column(
        str_enum(BuildingCategory, "building_category"), nullable=False
    )
    layout: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, comment="Schematic scene placement {position:[x,y,z], size:[w,h,d]} — not survey-grade"
    )

    station: Mapped[Station] = relationship(back_populates="buildings")
    assets: Mapped[list["Asset"]] = relationship(back_populates="building", order_by="Asset.code")


class Asset(TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("station_id", "code", name="uq_assets_station_code"),)

    id: Mapped[str] = mapped_column(String(128), primary_key=True, comment="'<station>.<code>'")
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    building_id: Mapped[str | None] = mapped_column(
        ForeignKey("buildings.id", ondelete="SET NULL"), index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    asset_type: Mapped[AssetType] = mapped_column(str_enum(AssetType, "asset_type"), nullable=False)
    system: Mapped[SystemType] = mapped_column(str_enum(SystemType, "system_type"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    station: Mapped[Station] = relationship(back_populates="assets")
    building: Mapped[Building | None] = relationship(back_populates="assets")
    channels: Mapped[list["TelemetryChannel"]] = relationship(
        back_populates="asset", order_by="TelemetryChannel.metric", cascade="all, delete-orphan"
    )


class TelemetryChannel(TimestampMixin, Base):
    """A metric an asset is *expected* to report.

    Channels are what make "missing" explicit: if a channel has no usable
    reading, the twin reports it as MISSING instead of omitting or zeroing it.
    """

    __tablename__ = "telemetry_channels"
    __table_args__ = (UniqueConstraint("asset_id", "metric", name="uq_telemetry_channels_asset_metric"),)

    id: Mapped[str] = mapped_column(String(160), primary_key=True, comment="'<asset_id>.<metric>'")
    station_id: Mapped[str] = mapped_column(
        ForeignKey("stations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    description: Mapped[str | None] = mapped_column(String(256))
    expected_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    stale_after_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    warn_low: Mapped[float | None] = mapped_column(Float)
    warn_high: Mapped[float | None] = mapped_column(Float)
    crit_low: Mapped[float | None] = mapped_column(Float)
    crit_high: Mapped[float | None] = mapped_column(Float)

    asset: Mapped[Asset] = relationship(back_populates="channels")
