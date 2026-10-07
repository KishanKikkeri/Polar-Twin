"""TimescaleDB support (PostgreSQL only).

The development setup keeps working on SQLite and plain PostgreSQL: every
function here first checks the dialect and extension availability, and the
migration (``0003``) is a no-op when TimescaleDB is absent.

Layout when enabled:

* ``telemetry_readings`` becomes a hypertable partitioned on ``observed_at``
  (7-day chunks). The primary key becomes ``(id, observed_at)`` because
  TimescaleDB requires every unique index to include the partition column;
  the natural-key unique index already includes it.
* Compression (segment by ``channel_id``) after 30 days and an hourly
  continuous aggregate ``telemetry_hourly`` — only when the TSL-licensed
  features are available (``timescaledb.license = 'timescale'``).
* No retention policy: raw scientific/operational history is kept.
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection

HYPERTABLE = "telemetry_readings"
TIME_COLUMN = "observed_at"
CHUNK_INTERVAL = "7 days"
COMPRESS_AFTER = "30 days"
CAGG_NAME = "telemetry_hourly"


@dataclass(frozen=True)
class TimescaleStatus:
    dialect: str
    available: bool
    installed_version: str | None
    license: str | None
    hypertable: bool

    @property
    def tsl_features(self) -> bool:
        return self.license == "timescale"


def hypertable_statements() -> list[str]:
    """DDL converting ``telemetry_readings`` to a hypertable (runs inside the migration transaction)."""
    return [
        "CREATE EXTENSION IF NOT EXISTS timescaledb",
        f"ALTER TABLE {HYPERTABLE} DROP CONSTRAINT IF EXISTS pk_{HYPERTABLE}",
        f"ALTER TABLE {HYPERTABLE} ADD CONSTRAINT pk_{HYPERTABLE} PRIMARY KEY (id, {TIME_COLUMN})",
        (
            f"SELECT create_hypertable('{HYPERTABLE}', '{TIME_COLUMN}', "
            f"chunk_time_interval => INTERVAL '{CHUNK_INTERVAL}', migrate_data => TRUE, if_not_exists => TRUE)"
        ),
    ]


def compression_statements() -> list[str]:
    """TSL-only: native compression for older chunks."""
    return [
        (
            f"ALTER TABLE {HYPERTABLE} SET (timescaledb.compress, "
            f"timescaledb.compress_segmentby = 'channel_id', timescaledb.compress_orderby = '{TIME_COLUMN} DESC')"
        ),
        f"SELECT add_compression_policy('{HYPERTABLE}', INTERVAL '{COMPRESS_AFTER}', if_not_exists => TRUE)",
    ]


def continuous_aggregate_statements() -> list[str]:
    """TSL-only: hourly roll-up. Must run outside a transaction block (autocommit).

    MISSING samples have ``value IS NULL`` so ``avg/min/max`` ignore them and
    ``n_valid`` vs ``n_total`` exposes data completeness instead of hiding it.
    """
    return [
        (
            f"CREATE MATERIALIZED VIEW IF NOT EXISTS {CAGG_NAME} WITH (timescaledb.continuous) AS "
            f"SELECT time_bucket(INTERVAL '1 hour', {TIME_COLUMN}) AS bucket, station_id, channel_id, provenance, "
            "avg(value) AS avg_value, min(value) AS min_value, max(value) AS max_value, "
            "count(value) AS n_valid, count(*) AS n_total "
            f"FROM {HYPERTABLE} GROUP BY bucket, station_id, channel_id, provenance WITH NO DATA"
        ),
        (
            f"SELECT add_continuous_aggregate_policy('{CAGG_NAME}', start_offset => INTERVAL '3 days', "
            "end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE)"
        ),
    ]


def downgrade_statements() -> list[str]:
    """Remove TSL objects. Converting a hypertable back to a plain table is not supported by TimescaleDB."""
    return [
        f"DROP MATERIALIZED VIEW IF EXISTS {CAGG_NAME}",
        f"SELECT remove_compression_policy('{HYPERTABLE}', if_exists => TRUE)",
    ]


def detect(conn: Connection) -> TimescaleStatus:
    dialect = conn.dialect.name
    if dialect != "postgresql":
        return TimescaleStatus(dialect, False, None, None, False)
    available = bool(conn.execute(text("SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'")).scalar())
    version = conn.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")).scalar()
    license_ = None
    hypertable = False
    if version:
        license_ = conn.execute(text("SELECT current_setting('timescaledb.license', true)")).scalar()
        hypertable = bool(
            conn.execute(
                text("SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = :t"),
                {"t": HYPERTABLE},
            ).scalar()
        )
    return TimescaleStatus(dialect, available, version, license_, hypertable)
