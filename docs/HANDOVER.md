# POLARTWIN — Agent 1 Backend Handover Note

**Branch:** `feat/backend-twin-core`  
**Task:** Backend Foundation and Digital Twin Vertical Slice (SIH26060)

---

## 1. Overview of Delivered Work

We have implemented the complete backend foundation and first Digital Twin vertical slice for POLARTWIN, enabling remote monitoring of India's **Maitri** and **Bharati** Antarctic research stations.

### Key Architectural Highlights
- **Frameworks:** Python, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic.
- **Portability:** Production-ready PostgreSQL driver (`psycopg3`), fully operational with SQLite for instant local zero-setup dev and testing.
- **Separation of Raw Telemetry vs. Twin State:** Append-only raw telemetry table (`telemetry_readings`) is cleanly separated from the twin state read model (`TwinService.overview()`).
- **Data Provenance:** Strict enums (`REAL_OBSERVATION`, `SYNTHETIC`, `DERIVED`, `PREDICTED`, `SIMULATED`, `SCENARIO`). Predictions and simulations are stored and queryable but never overwrite observed twin state.
- **Missing Data Handling:** Explicit quality flag `MISSING` with `value: null`. Zero coercion is strictly prevented via database `CheckConstraint` and Pydantic validators.
- **Freshness & Condition State Engine:** Automatic evaluation of channel freshness (`FRESH`, `STALE`, `MISSING`) and condition thresholds (`NORMAL`, `WARNING`, `CRITICAL`, `UNKNOWN`).

---

## 2. Endpoints Implemented

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Operational health check (service status + database connectivity) |
| `/api/v1/stations` | GET | List stations (Maitri & Bharati metadata & coordinates) |
| `/api/v1/stations/{station_id}` | GET | Station detail with building topology and asset counts |
| `/api/v1/stations/{station_id}/overview` | GET | Digital Twin aggregated overview read-model at `as_of` |
| `/api/v1/stations/{station_id}/assets` | GET | Station assets and their expected telemetry channels |
| `/api/v1/stations/{station_id}/telemetry` | GET | Raw telemetry search & filter (by asset, metric, provenance, quality, time window) |

---

## 3. Schemas

The API schemas are organized in `app/schemas/`:
- `app.schemas.common`: `ErrorResponse`, `ErrorDetail`, `Coordinates`, `ApiModel`.
- `app.schemas.health`: `HealthResponse`, `DatabaseHealth`.
- `app.schemas.station`: `StationSummary`, `StationDetail`, `BuildingSchema`, `AssetSchema`, `ChannelSchema`, `StationListResponse`, `AssetListResponse`.
- `app.schemas.telemetry`: `TelemetryReadingSchema`, `TelemetryFilters`, `TelemetryPage`.
- `app.schemas.overview`: `StationOverview`, `AssetState`, `ChannelState`, `SystemSummary`, `StateCounts`, `ReadingValue`.

---

## 4. Operational Commands

### Local Virtualenv Setup
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # or: source .venv/bin/activate
pip install -r requirements-dev.txt
```

### Database Migrations
```bash
# Uses POLARTWIN_DATABASE_URL from .env or defaults
alembic upgrade head
```

### Seeding Data
```bash
# Upserts stations, buildings, assets, channels, and 24h deterministic synthetic telemetry
python -m app.seed

# Optional flags:
python -m app.seed --reset           # Regenerate telemetry up to current timestamp
python -m app.seed --topology-only   # Seed stations and assets without telemetry
```

### Running the API Server
```bash
uvicorn app.main:app --reload --port 8000
```
Interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Running Tests
```bash
pytest -v
```
All 50 unit and integration tests execute against an in-memory SQLite database in ~2 seconds with zero live external dependencies.

---

## 5. Limitations & Assumptions

1. **No Live Station Telemetry:** All operational data in this build has provenance `SYNTHETIC` or `DERIVED`. The API explicitly flags `contains_real_observations: false` and includes a `data_notice` in the overview payload.
2. **Simplified Forecast Model:** PREDICTED data is seeded via a toy linear consumption forecast for demonstration purposes. A full ML pipeline is not included, as per scope.
3. **No Frontend Modifications:** Frontend code in `src/` was inspected for topology IDs and metric scales but remains untouched.
4. **No Authentication / Authorization:** Multi-role RBAC (Station Operator vs. MoES-HQ) is documented in the SIH design goals but not enforced in this first core vertical slice.

---

## 6. Changed & Created Files

### Backend Application Code
- `backend/requirements.txt`: Runtime dependencies
- `backend/requirements-dev.txt`: Development and test dependencies
- `backend/pyproject.toml`: Pytest configuration
- `backend/.env.example`: Configuration templates
- `backend/docker-compose.yml`: Local PostgreSQL container configuration
- `backend/alembic.ini`: Alembic migration configuration
- `backend/alembic/env.py`: Alembic environment script
- `backend/alembic/script.py.mako`: Migration template
- `backend/alembic/versions/20261007_0001_initial_twin_core_schema.py`: Initial migration
- `backend/app/__init__.py`: Version marker
- `backend/app/main.py`: FastAPI app entrypoint, CORS, routers
- `backend/app/core/config.py`: Pydantic settings
- `backend/app/core/errors.py`: Domain errors & handlers
- `backend/app/core/timeutil.py`: Timezone/UTC utilities
- `backend/app/db/base.py`: DeclarativeBase, portable UTCDateTime, Enum types
- `backend/app/db/session.py`: Database engine & sessionmaker
- `backend/app/domain/enums.py`: Provenance, Quality, Freshness, Condition, System enums
- `backend/app/domain/twin_state.py`: Pure evaluation rules for freshness & thresholds
- `backend/app/models/topology.py`: Station, Building, Asset, TelemetryChannel ORM models
- `backend/app/models/telemetry.py`: TelemetryReading ORM model with CHECK constraint
- `backend/app/repositories/topology.py`: Station & Asset repository
- `backend/app/repositories/telemetry.py`: Telemetry repository & window functions
- `backend/app/services/station_service.py`: Station & asset business logic
- `backend/app/services/telemetry_service.py`: Telemetry query logic
- `backend/app/services/twin_service.py`: Twin overview read-model aggregator
- `backend/app/seed/catalog.py`: Topology specifications aligned with frontend layouts
- `backend/app/seed/seeder.py`: Seed data generation engine
- `backend/app/seed/__main__.py`: Seeder CLI entrypoint
- `backend/app/api/health.py`: Health check router
- `backend/app/api/v1/stations.py`: Versioned stations router

### Tests
- `backend/tests/conftest.py`: In-memory SQLite fixtures & clients
- `backend/tests/test_health.py`: Health and OpenAPI endpoint tests
- `backend/tests/test_stations.py`: Station & asset endpoint tests
- `backend/tests/test_telemetry.py`: Raw telemetry filtering & validation tests
- `backend/tests/test_overview.py`: Twin overview read-model & provenance isolation tests
- `backend/tests/test_db_constraints.py`: Database-level integrity tests
- `backend/tests/test_seed.py`: Seed idempotency tests
- `backend/tests/test_migrations.py`: Alembic upgrade/downgrade lifecycle tests

### Documentation & Infrastructure
- `.gitignore`: Updated with Python, venv, and SQLite patterns
- `backend/README.md`: Backend developer guide
- `docs/API_CONTRACT.md`: Full API contract documentation
- `docs/HANDOVER.md`: Handover notes for subsequent agents
