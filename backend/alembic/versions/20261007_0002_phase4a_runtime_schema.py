"""phase 4a runtime schema

Adds ingestion metadata to telemetry_readings (event_id, ingest_flags) and a
natural-key unique index (channel_id, observed_at, provenance, source) used for
duplicate detection. Creates twin_alerts (alert lifecycle), twin_events
(operational event log) and audit_events (hash-chained audit trail).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-07 09:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.db.base


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SEVERITY = ('INFO', 'WARNING', 'CRITICAL')
_DOMAIN = ('ENVIRONMENT', 'HEATING', 'ENERGY', 'GENERATORS', 'FUEL', 'INVENTORY', 'LOGISTICS', 'RISK')
_EVENT_TYPES = (
    'ALERT_RAISED', 'ALERT_ESCALATED', 'ALERT_DEESCALATED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED',
    'TELEMETRY_GAP_OPENED', 'TELEMETRY_GAP_CLOSED', 'TELEMETRY_CONFLICT', 'LINK_DOWN', 'LINK_UP',
    'BUFFER_FLUSHED', 'BUFFER_OVERFLOW', 'RUNTIME_STARTED', 'RUNTIME_STOPPED',
    'PERTURBATION_APPLIED', 'PERTURBATION_CLEARED',
)


def _enum(values, name):
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=32)


def upgrade() -> None:
    with op.batch_alter_table('telemetry_readings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('event_id', sa.String(length=96), nullable=True,
                                      comment='Producer-assigned idempotency key (TelemetryEvent.event_id)'))
        batch_op.add_column(sa.Column('ingest_flags', sa.String(length=64), nullable=True,
                                      comment='Comma-separated: OUT_OF_ORDER, DELAYED, GAP_MARKER'))
        batch_op.create_index('uq_telemetry_readings_natural_key',
                              ['channel_id', 'observed_at', 'provenance', 'source'], unique=True)
        batch_op.create_index('ix_telemetry_readings_event_id', ['event_id'], unique=False)

    op.create_table('twin_alerts',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('station_id', sa.String(length=32), nullable=False),
    sa.Column('rule_id', sa.String(length=96), nullable=False),
    sa.Column('dedup_key', sa.String(length=256), nullable=False),
    sa.Column('severity', _enum(_SEVERITY, 'alert_severity'), nullable=False),
    sa.Column('state', _enum(('OPEN', 'ACKNOWLEDGED', 'RESOLVED'), 'alert_state'), nullable=False),
    sa.Column('source', _enum(('THRESHOLD', 'DATA_QUALITY', 'DEPENDENCY', 'INGESTION'), 'alert_source'), nullable=False),
    sa.Column('domain', _enum(_DOMAIN, 'twin_domain'), nullable=True),
    sa.Column('title', sa.String(length=256), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('recommended_action', sa.Text(), nullable=True),
    sa.Column('asset_id', sa.String(length=128), nullable=True),
    sa.Column('channel_id', sa.String(length=160), nullable=True),
    sa.Column('node_id', sa.String(length=128), nullable=True),
    sa.Column('value', sa.Float(), nullable=True),
    sa.Column('threshold', sa.Float(), nullable=True),
    sa.Column('unit', sa.String(length=24), nullable=True),
    sa.Column('evidence_provenance', sa.String(length=32), nullable=True,
              comment='Provenance of the data the rule evaluated (e.g. SYNTHETIC)'),
    sa.Column('evidence', sa.JSON(), nullable=True),
    sa.Column('raised_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('last_evaluated_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('acknowledged_at', app.db.base.UTCDateTime(timezone=True), nullable=True),
    sa.Column('acknowledged_by', sa.String(length=128), nullable=True),
    sa.Column('acknowledgement_note', sa.Text(), nullable=True),
    sa.Column('resolved_at', app.db.base.UTCDateTime(timezone=True), nullable=True),
    sa.Column('occurrences', sa.Integer(), nullable=False),
    sa.Column('clear_streak', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['station_id'], ['stations.id'], name=op.f('fk_twin_alerts_station_id_stations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_twin_alerts'))
    )
    with op.batch_alter_table('twin_alerts', schema=None) as batch_op:
        batch_op.create_index('ix_twin_alerts_station_state', ['station_id', 'state'], unique=False)
        batch_op.create_index('ix_twin_alerts_dedup_key', ['dedup_key'], unique=False)

    op.create_table('twin_events',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('occurred_at', app.db.base.UTCDateTime(timezone=True), nullable=False, comment='Simulation/twin time'),
    sa.Column('recorded_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('station_id', sa.String(length=32), nullable=True),
    sa.Column('event_type', _enum(_EVENT_TYPES, 'event_type'), nullable=False),
    sa.Column('severity', _enum(_SEVERITY, 'event_severity'), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('alert_id', sa.String(length=64), nullable=True),
    sa.Column('asset_id', sa.String(length=128), nullable=True),
    sa.Column('channel_id', sa.String(length=160), nullable=True),
    sa.Column('actor', sa.String(length=128), nullable=True),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_twin_events'))
    )
    with op.batch_alter_table('twin_events', schema=None) as batch_op:
        batch_op.create_index('ix_twin_events_station_ts', ['station_id', 'occurred_at'], unique=False)

    op.create_table('audit_events',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('occurred_at', app.db.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('actor_id', sa.String(length=128), nullable=False),
    sa.Column('actor_roles', sa.String(length=256), nullable=False),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('resource_type', sa.String(length=64), nullable=False),
    sa.Column('resource_id', sa.String(length=160), nullable=True),
    sa.Column('station_id', sa.String(length=32), nullable=True),
    sa.Column('outcome', _enum(('SUCCESS', 'DENIED', 'FAILURE'), 'audit_outcome'), nullable=False),
    sa.Column('request_id', sa.String(length=64), nullable=True),
    sa.Column('client_ip', sa.String(length=64), nullable=True),
    sa.Column('details', sa.JSON(), nullable=True),
    sa.Column('prev_hash', sa.String(length=64), nullable=True),
    sa.Column('hash', sa.String(length=64), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_events'))
    )
    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.create_index('ix_audit_events_occurred', ['occurred_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.drop_index('ix_audit_events_occurred')
    op.drop_table('audit_events')
    with op.batch_alter_table('twin_events', schema=None) as batch_op:
        batch_op.drop_index('ix_twin_events_station_ts')
    op.drop_table('twin_events')
    with op.batch_alter_table('twin_alerts', schema=None) as batch_op:
        batch_op.drop_index('ix_twin_alerts_dedup_key')
        batch_op.drop_index('ix_twin_alerts_station_state')
    op.drop_table('twin_alerts')
    with op.batch_alter_table('telemetry_readings', schema=None) as batch_op:
        batch_op.drop_index('ix_telemetry_readings_event_id')
        batch_op.drop_index('uq_telemetry_readings_natural_key')
        batch_op.drop_column('ingest_flags')
        batch_op.drop_column('event_id')
