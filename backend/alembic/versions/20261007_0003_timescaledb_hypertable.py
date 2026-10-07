"""timescaledb hypertable for telemetry

PostgreSQL + TimescaleDB only. No-op on SQLite, on PostgreSQL without the
timescaledb extension available, or when POLARTWIN_TIMESCALEDB_ENABLED=false.
TSL features (compression, continuous aggregate) are applied only when
timescaledb.license = 'timescale'. See app/db/timescale.py.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07 09:05:00

"""
import logging
from typing import Sequence, Union

from alembic import op

from app.core.config import get_settings
from app.db import timescale


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        log.info("TimescaleDB migration skipped: dialect %s", bind.dialect.name)
        return
    if not get_settings().timescaledb_enabled:
        log.info("TimescaleDB migration skipped: POLARTWIN_TIMESCALEDB_ENABLED=false")
        return
    status = timescale.detect(bind)
    if not status.available:
        log.warning("TimescaleDB extension not available; telemetry_readings stays a plain table")
        return

    for stmt in timescale.hypertable_statements():
        op.execute(stmt)

    status = timescale.detect(bind)
    if not status.tsl_features:
        log.warning("TimescaleDB license %r: skipping compression and continuous aggregate", status.license)
        return
    for stmt in timescale.compression_statements():
        op.execute(stmt)
    with op.get_context().autocommit_block():
        for stmt in timescale.continuous_aggregate_statements():
            op.execute(stmt)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    status = timescale.detect(bind)
    if not status.installed_version or not status.tsl_features:
        return
    with op.get_context().autocommit_block():
        for stmt in timescale.downgrade_statements():
            op.execute(stmt)
