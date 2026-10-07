"""FastAPI application factory.

Run locally:  uvicorn app.main:app --reload   (from the backend/ directory)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.health import router as health_router
from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.observability.middleware import RequestContextMiddleware

DESCRIPTION = """
Backend for **POLARTWIN** (SIH26060) — a Digital Twin platform for remote
management of India's **Maitri** and **Bharati** Antarctic research stations.

**Data disclaimer:** this build has *no* connection to real station systems.
All telemetry is labelled with explicit `provenance`; seeded data is
`SYNTHETIC`. See `docs/API_CONTRACT.md` for the full contract.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(level=settings.log_level, json_logs=settings.log_json)

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=DESCRIPTION,
        openapi_tags=[
            {"name": "health", "description": "Operational status and Prometheus metrics"},
            {"name": "stations", "description": "Stations, assets, telemetry and twin overview"},
            {"name": "runtime", "description": "Continuous telemetry runtime, causal graph, alerts, and audit"},
        ],
    )
    # Request correlation, access logging and latency metrics
    app.add_middleware(RequestContextMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
