"""initial twin core schema

Creates static topology (stations, buildings, assets, telemetry_channels) and the
append-only raw telemetry_readings table. Enums are portable VARCHAR + CHECK.
A CHECK constraint guarantees quality='MISSING' <=> value IS NULL.
No data is inserted here; run `python -m app.seed` for development data.

Revision ID: 0001
Revises: 
Create Date: 2026-10-07 01:53:30.510250

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.db.base


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('stations',
    sa.Column('id', sa.String(length=32), nullable=False, comment="Stable slug, e.g. 'maitri'"),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('short_name', sa.String(length=64), nullable=False),
    sa.Column('location', sa.String(length=256), nullable=False),
    sa.Column('region', sa.String(length=256), nullable=True),
    sa.Column('operator', sa.String(length=256), nullable=False),
    sa.Column('purpose', sa.Text(), nullable=True),
    sa.Column('established_year', sa.Integer(), nullable=True),
    sa.Column('latitude', sa.Float(), nullable=False),
    sa.Column('longitude', sa.Float(), nullable=False),
    sa.Column('created_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_stations'))
    )
    op.create_table('buildings',
    sa.Column('id', sa.String(length=96), nullable=False, comment="'<station>.<code>'"),
    sa.Column('station_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False, comment="Matches frontend object id, e.g. 'power-house'"),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('subtitle', sa.String(length=256), nullable=True),
    sa.Column('category', sa.Enum('building', 'container', 'lab', 'electricity', 'heating', 'comms', 'water', 'fuel', 'waste', 'pad', name='building_category', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('layout', sa.JSON(), nullable=True, comment='Schematic scene placement {position:[x,y,z], size:[w,h,d]} — not survey-grade'),
    sa.Column('created_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], name=op.f('fk_buildings_station_id_stations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_buildings')),
    sa.UniqueConstraint('station_id', 'code', name='uq_buildings_station_code')
    )
    with op.batch_alter_table('buildings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_buildings_station_id'), ['station_id'], unique=False)

    op.create_table('assets',
    sa.Column('id', sa.String(length=128), nullable=False, comment="'<station>.<code>'"),
    sa.Column('station_id', sa.String(length=32), nullable=False),
    sa.Column('building_id', sa.String(length=96), nullable=True),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('asset_type', sa.Enum('GENERATOR', 'ELECTRICAL_BUS', 'FUEL_TANK', 'FUEL_INVENTORY', 'WATER_TANK', 'PUMP', 'DESALINATION_UNIT', 'HEATING_UNIT', 'COMMS_LINK', 'WASTE_UNIT', 'ENVIRONMENT_SENSOR', 'WEATHER_STATION', name='asset_type', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('system', sa.Enum('ELECTRICITY', 'FUEL', 'WATER', 'HEATING', 'COMMUNICATION', 'WASTE', 'ENVIRONMENT', 'WEATHER', name='system_type', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name=op.f('fk_assets_building_id_buildings'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], name=op.f('fk_assets_station_id_stations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_assets')),
    sa.UniqueConstraint('station_id', 'code', name='uq_assets_station_code')
    )
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_assets_building_id'), ['building_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_assets_station_id'), ['station_id'], unique=False)

    op.create_table('telemetry_channels',
    sa.Column('id', sa.String(length=160), nullable=False, comment="'<asset_id>.<metric>'"),
    sa.Column('station_id', sa.String(length=32), nullable=False),
    sa.Column('asset_id', sa.String(length=128), nullable=False),
    sa.Column('metric', sa.String(length=64), nullable=False),
    sa.Column('unit', sa.String(length=24), nullable=False),
    sa.Column('description', sa.String(length=256), nullable=True),
    sa.Column('expected_interval_seconds', sa.Integer(), nullable=False),
    sa.Column('stale_after_seconds', sa.Integer(), nullable=False),
    sa.Column('warn_low', sa.Float(), nullable=True),
    sa.Column('warn_high', sa.Float(), nullable=True),
    sa.Column('crit_low', sa.Float(), nullable=True),
    sa.Column('crit_high', sa.Float(), nullable=True),
    sa.Column('created_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['assets.id'], name=op.f('fk_telemetry_channels_asset_id_assets'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], name=op.f('fk_telemetry_channels_station_id_stations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_telemetry_channels')),
    sa.UniqueConstraint('asset_id', 'metric', name='uq_telemetry_channels_asset_metric')
    )
    with op.batch_alter_table('telemetry_channels', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_telemetry_channels_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_telemetry_channels_station_id'), ['station_id'], unique=False)

    op.create_table('telemetry_readings',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('channel_id', sa.String(length=160), nullable=False),
    sa.Column('station_id', sa.String(length=32), nullable=False),
    sa.Column('asset_id', sa.String(length=128), nullable=False),
    sa.Column('metric', sa.String(length=64), nullable=False),
    sa.Column('observed_at', app.db.base.UTCDateTime(timezone=True), nullable=False, comment='When the value applies (for predictions: the target time)'),
    sa.Column('ingested_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('value', sa.Float(), nullable=True),
    sa.Column('unit', sa.String(length=24), nullable=False),
    sa.Column('provenance', sa.Enum('REAL_OBSERVATION', 'SYNTHETIC', 'DERIVED', 'PREDICTED', 'SIMULATED', 'SCENARIO', name='provenance', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('quality', sa.Enum('GOOD', 'SUSPECT', 'BAD', 'MISSING', name='quality', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('source', sa.String(length=128), nullable=False, comment="Producer identifier, e.g. 'seed:synthetic-v1'"),
    sa.CheckConstraint("(quality = 'MISSING' AND value IS NULL) OR (quality <> 'MISSING' AND value IS NOT NULL)", name=op.f('ck_telemetry_readings_value_matches_quality')),
    sa.ForeignKeyConstraint(['asset_id'], ['assets.id'], name=op.f('fk_telemetry_readings_asset_id_assets'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['channel_id'], ['telemetry_channels.id'], name=op.f('fk_telemetry_readings_channel_id_telemetry_channels'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], name=op.f('fk_telemetry_readings_station_id_stations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_telemetry_readings'))
    )
    with op.batch_alter_table('telemetry_readings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_telemetry_readings_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index('ix_telemetry_readings_channel_observed', ['channel_id', 'observed_at'], unique=False)
        batch_op.create_index('ix_telemetry_readings_station_observed', ['station_id', 'observed_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('telemetry_readings', schema=None) as batch_op:
        batch_op.drop_index('ix_telemetry_readings_station_observed')
        batch_op.drop_index('ix_telemetry_readings_channel_observed')
        batch_op.drop_index(batch_op.f('ix_telemetry_readings_asset_id'))

    op.drop_table('telemetry_readings')
    with op.batch_alter_table('telemetry_channels', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_telemetry_channels_station_id'))
        batch_op.drop_index(batch_op.f('ix_telemetry_channels_asset_id'))

    op.drop_table('telemetry_channels')
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_assets_station_id'))
        batch_op.drop_index(batch_op.f('ix_assets_building_id'))

    op.drop_table('assets')
    with op.batch_alter_table('buildings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_buildings_station_id'))

    op.drop_table('buildings')
    op.drop_table('stations')
