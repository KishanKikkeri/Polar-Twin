"""CLI: ``python -m app.seed [--reset] [--topology-only]``.

Run ``alembic upgrade head`` first so the schema exists.
"""

import argparse
import logging
import sys

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.seed.seeder import seed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed POLARTWIN with Maitri/Bharati topology and SYNTHETIC telemetry.")
    parser.add_argument("--reset", action="store_true",
                        help="Delete previously seeded telemetry (source 'seed:*') and regenerate it ending now.")
    parser.add_argument("--topology-only", action="store_true", help="Seed stations/buildings/assets/channels only.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    url = get_settings().database_url
    safe_url = url.split("@")[-1] if "@" in url else url
    logging.info("Seeding database at %s", safe_url)

    with get_session_factory()() as session:
        result = seed(session, reset_telemetry=args.reset, with_telemetry=not args.topology_only)

    logging.info("Topology upserted: %s", result.topology)
    for station_id, n in result.telemetry_inserted.items():
        logging.info("Telemetry inserted for %s: %d readings", station_id, n)
    for station_id in result.telemetry_skipped:
        logging.info("Telemetry already present for %s — skipped (use --reset to regenerate)", station_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
