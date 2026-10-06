# POLARTWIN Backend

Digital Twin platform backend for India's **Maitri** and **Bharati** Antarctic research stations (SIH 2026 Problem Statement SIH26060).

Built with Python, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, and PostgreSQL (with zero-setup SQLite support for local dev).

---

## Quickstart

### 1. Prerequisites
- Python 3.11+ (Python 3.14 verified)
- Optional: Docker (for local PostgreSQL container)

### 2. Set Up Virtual Environment

From the repository root:

```bash
cd backend
python -m venv .venv

# On Windows (PowerShell):
.\.venv\Scripts\Activate.ps1

# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements-dev.txt
```

### 3. Configure Database

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

You can choose between:
- **Zero-setup local SQLite** (default in `.env.example`):
  `POLARTWIN_DATABASE_URL=sqlite:///polartwin.db`
- **Local PostgreSQL via Docker**:
  ```bash
  docker compose up -d
  # and set in .env:
  POLARTWIN_DATABASE_URL=postgresql+psycopg://polartwin:polartwin@localhost:5432/polartwin
  ```

### 4. Run Migrations & Seed Data

```bash
# Apply database schema
alembic upgrade head

# Seed Maitri & Bharati topology and synthetic telemetry history
python -m app.seed
```

Options for seeding:
- `--reset`: Clears existing seeded telemetry (`seed:*`) and regenerates 24h history up to now.
- `--topology-only`: Seeds stations, buildings, assets, and channels without telemetry.

### 5. Start the Development Server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be accessible at:
- **API Base:** [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **OpenAPI Schema:** [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)

---

## Running Tests

Tests run against an in-memory SQLite database and require zero external services or live credentials:

```bash
pytest -v
```

---

## API Endpoints

| Method | Path | Summary |
|---|---|---|
| `GET` | `/health` | Health check (app, version, database status) |
| `GET` | `/api/v1/stations` | List stations (Maitri & Bharati) |
| `GET` | `/api/v1/stations/{station_id}` | Station detail with buildings and asset counts |
| `GET` | `/api/v1/stations/{station_id}/overview` | Digital Twin aggregated overview read-model |
| `GET` | `/api/v1/stations/{station_id}/assets` | Station assets and their telemetry channels |
| `GET` | `/api/v1/stations/{station_id}/telemetry` | Raw telemetry search & filter |

See [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) for detailed schemas and semantics.
