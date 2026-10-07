import tempfile
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_and_downgrade():
    backend_dir = Path(__file__).resolve().parent.parent
    ini_path = backend_dir / "alembic.ini"

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    try:
        sqlite_url = f"sqlite:///{db_path}"
        alembic_cfg = Config(str(ini_path))
        alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
        alembic_cfg.attributes["database_url"] = sqlite_url

        # Upgrade to head (including 0001, 0002, 0003)
        command.upgrade(alembic_cfg, "head")

        engine = create_engine(sqlite_url)
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert {
            "stations",
            "buildings",
            "assets",
            "telemetry_channels",
            "telemetry_readings",
            "twin_alerts",
            "twin_events",
            "audit_events",
        } <= tables

        # Downgrade to base
        command.downgrade(alembic_cfg, "base")
        inspector_after = inspect(engine)
        remaining = set(inspector_after.get_table_names())
        assert not ({"stations", "buildings", "assets", "telemetry_readings", "twin_alerts", "twin_events", "audit_events"} & remaining)
    finally:
        try:
            Path(db_path).unlink(missing_ok=True)
        except OSError:
            pass
