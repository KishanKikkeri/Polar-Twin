# POLARTWIN

**Smart India Hackathon 2026 — Problem Statement SIH26060**  
*"Digital Platform for efficient remote management of Indian Antarctic Research Stations"*  
**Theme:** Disaster Management · **Sponsoring Ministry:** Ministry of Earth Sciences (MoES) / NCPOR

---

## Overview

**POLARTWIN** is a full-stack, enterprise-grade Cyber-Physical Digital Twin platform designed for the autonomous monitoring, predictive risk intelligence, and remote contingency management of India's **Maitri** and **Bharati** Antarctic research stations.

The platform bridges physical infrastructure telemetry with a **causal dependency simulation runtime**, **machine learning intelligence**, and a **grounded decision-support & contingency engine** with an interactive **3D spatial HUD**.

```
                ┌────────────────────────────────────────────────────────┐
                │          Interactive 3D Digital Twin HUD & GIS         │
                │        (Three.js / React / Framer Motion / Vite)       │
                └───────────────────────────┬────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Decision & Operations Layer (Agent 4C)                          │
│  • Grounded Operations Copilot (NL -> Facts)   • Auditable What-If Scenario Engine     │
│  • Antarctic Emergency Mode Hierarchy          • Historical Replay Scrubbing           │
└───────────────────────┬────────────────────────────────────────┬───────────────────────┘
                        │                                        │
                        ▼                                        ▼
┌───────────────────────────────────────────────┐ ┌──────────────────────────────────────┐
│        ML Intelligence Layer (Agent 4B)       │ │     Living Twin Runtime (Agent 4A)   │
│  • 24h/7d Demand Forecasting (Ridge Regression│ │  • Causal Dependency Propagation DAG │
│  • Robust Seasonal Z-Score Anomaly Detection  │ │  • Idempotent Ingestion Pipeline     │
│  • Predictive Maintenance & Degradation       │ │  • TimescaleDB-compatible Telemetry  │
│  • Logistics & Fuel Depletion Predictor       │ │  • Alert Engine & RBAC Audit Trail   │
└───────────────────────────────────────────────┘ └──────────────────────────────────────┘
```

---

## Key Capabilities

### 1. Living Digital Twin Runtime & Infrastructure (`backend/`)
- **Causal Dependency Propagation DAG**: Deterministic multi-domain DAG that models causal chains:
  $$\text{Outdoor Temperature} \rightarrow \text{Thermal Loss} \rightarrow \text{Heating Demand} \rightarrow \text{Generator Load} \rightarrow \text{Fuel Burn} \rightarrow \text{Reserve Autonomy} \rightarrow \text{Risk/Alerts}$$
- **Telemetry Ingestion & Buffering**: High-throughput `/api/v1/telemetry/ingest` pipeline with deduplication, conflict detection, out-of-order queue buffering, and TimescaleDB hypertable chunking.
- **Rule-Based Alert Engine**: Evaluates cross-system telemetry rules, manages alert lifecycles (`ACTIVE` $\rightarrow$ `ACKNOWLEDGED` $\rightarrow$ `RESOLVED`), and logs actor-attributed audit records.
- **Role-Based Access Control (RBAC)**: JWT authentication with granular permissions (`telemetry:ingest`, `twin:read`, `perturbation:apply`, `alerts:ack`, `runtime:control`).
- **Observability**: Prometheus metrics exporter (`/metrics`), request correlation headers, structured JSON logging, and health readiness probes (`/health`).

### 2. Machine Learning Intelligence Layer (`src/intelligence/`)
- **Energy Demand Forecasting**: Multi-horizon (24h and 7d) forecasting combining time-of-day Fourier harmonics, ambient temperatures, and lag-24 demand features with Gaussian uncertainty intervals (outperforms seasonal-naive baselines by **67.62% MAE**).
- **Anomaly Detection**: Robust seasonal Z-score anomaly detector across critical telemetry streams with a pooled **0.8871 F1 score** and near-zero false-positive rate on clean baselines.
- **Predictive Maintenance**: Evaluates sensor trends (vibration, exhaust temperature, specific fuel consumption) to predict remaining useful life and failure probabilities.
- **Logistics & Fuel Autonomy**: Calibrated linear burn-rate models estimating resupply windows and depletion dates within a 3.4% relative error margin.
- **Actionable Optimization**: Heuristic recommendation engine prioritizing fuel conservation, load shedding, and heating consolidation.

### 3. Decision Support & Contingency Engine (`src/decision/`)
- **Deterministic What-If Scenario Engine**: Simulates contingencies (`generator_failure`, `cold_snap`, `fuel_shortage`, `resupply_delay`, `battery_degradation`) with cryptographic content hashing and audit replay validation.
- **Grounded Operations Copilot**: Natural-language operations assistant that answers queries strictly from structured platform facts, verified by `assertGrounded` to eliminate hallucinations.
- **Emergency Mode Prioritization**: Automatic view mode enforcing Antarctic life-safety hierarchies:
  $$\text{Critical Power} \succ \text{Heating} \succ \text{Communications} \succ \text{Medical} \succ \text{Fuel} \succ \text{Infrastructure}$$
- **Historical Scrubbing & Replay**: Reducer-driven time machine allowing operators to scrub, pause, and inspect past station telemetry and events.

### 4. Interactive 3D Digital Twin HUD & GIS Map (`src/components/`)
- **3D Blueprint Presentation**: High-density holographic/wireframe CAD visualization for Maitri and Bharati stations with full 360° orbital controls.
- **GIS Map $\leftrightarrow$ 3D Toggle**: Smooth transitions between satellite GIS coordinates and localized physical 3D asset markers.
- **Real-Time Weather Integration**: Live OpenWeather synchronization for Antarctic station coordinates with automatic simulated fallbacks.

---

## Repository Structure

```
Polar-Twin/
├── backend/                        # Python FastAPI Living Twin Backend
│   ├── alembic/versions/           # Database schema & TimescaleDB migrations
│   ├── app/
│   │   ├── api/v1/                 # Endpoints: /runtime, /stations, /alerts, /events
│   │   ├── domain/                 # Domain enums, entities, and RBAC permissions
│   │   ├── models/                 # SQLAlchemy ORM models (Station, Asset, Telemetry, Alert)
│   │   ├── observability/          # Prometheus metrics registry & logging middleware
│   │   ├── runtime/                # Causal DAG, ingestion pipeline, simulation clock
│   │   └── services/               # Station and telemetry query services
│   └── tests/                      # Pytest suite (71 tests)
├── src/
│   ├── components/                 # React Three Fiber 3D scene, HUD, dashboard panels
│   ├── decision/                   # What-If engine, Copilot, Emergency Mode, Replay, Adapters
│   ├── intelligence/               # ML models: forecast, anomaly, maintenance, risk, logistics
│   ├── services/api/               # HTTP client with resilient simulated fallback
│   └── types/                      # TypeScript / JSDoc contract interfaces
├── tests/
│   ├── decision/                   # Decision engine & E2E Killer Path integration tests
│   └── intelligence/               # Machine learning verification & benchmark tests
├── docs/                           # Architecture specs, API contracts, Phase 4 guides
└── scripts/                        # Model evaluation & synthetic benchmark scripts
```

---

## Quickstart Guide

### Prerequisites
- **Node.js** v20.x or higher
- **Python** 3.11+ (Python 3.12+ recommended)
- **Git**

---

### 1. Frontend & Decision Layer Setup

```bash
# Install frontend and decision engine dependencies
npm install

# Start the Vite development server (HUD & 3D view)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

#### Environment Variables (Optional):
Copy `.env.example` to `.env`:
```ini
VITE_API_BASE_URL=http://localhost:8000
VITE_OPENWEATHER_API_KEY=your_openweather_key_here
```
*Note: If backend or weather APIs are unreachable, POLARTWIN automatically switches to clearly-labelled synthetic simulation mode without blocking the interface.*

---

### 2. Backend Runtime Setup

```bash
cd backend

# Create and activate a Python virtual environment
python -m venv .venv

# Windows:
.\.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Install backend dependencies
pip install -e .

# Run database migrations
alembic upgrade head

# Seed station assets and initial telemetry
python -m app.db.seed

# Start the FastAPI live runtime server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Access API Documentation at:
- Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/health](http://localhost:8000/health)

---

## Testing & Quality Assurance

The codebase enforces strict unit, integration, and contract verification across both runtimes:

```bash
# Run all Node.js unit, ML, decision, and end-to-end integration tests (128 tests)
npm test

# Run backend Python tests (71 tests)
cd backend && pytest

# Run ML intelligence benchmark evaluation script
node scripts/evaluate-4b.mjs

# Build production bundle
npm run build
```

### Verification Results
| Component | Test Suite | Results | Execution Time |
| :--- | :--- | :--- | :--- |
| **Python Backend** | `pytest` | **71 / 71 passed** | ~3.7s |
| **Frontend & Decision** | `node --test` | **128 / 128 passed** | ~4.2s |
| **Production Build** | `vite build` | **Clean build** | ~4.3s |

---

## SIH26060 End-to-End "Killer Path" Scenario

POLARTWIN demonstrates the complete operational lifecycle in response to severe Antarctic contingencies:

1. **Environmental Shock**: Outdoor temperature at Maitri drops from -12°C to -35°C during a blizzard.
2. **Causal Propagation**: Thermal loss escalates $\rightarrow$ electrical heating demand increases from 180 kW to 270 kW.
3. **Infrastructure Strain**: Diesel Generator load spikes $\rightarrow$ fuel burn rate jumps $\rightarrow$ reserve autonomy decreases below safe thresholds.
4. **Automated Alerting**: Alert engine raises `ALT-COLD-01` (thermal warning) and `ALT-FUEL-02` (reserve warning).
5. **Operator Contingency (What-If)**: Operator tests scenario *"What if generator DG-1 fails for 8 hours?"*.
6. **Consequence Analysis**: Scenario engine calculates exact shortfall hours, unmet energy (kWh), and battery depletion rate.
7. **Actionable Recommendations**: Engine suggests starting standby DG-2/DG-3 and shedding non-essential science lab loads.
8. **Grounded Operations Copilot**: Operator asks Copilot for guidance; Copilot answers with zero hallucinations, quoting strict platform telemetry facts and audit run hashes.
9. **Emergency Mode**: Operator enters Emergency Mode, displaying prioritized, un-filterable life-safety systems (power, thermal, comms, medical).

---

## Data Disclaimer & Integrity
All operational telemetry streams carry explicit metadata:
- **Provenance**: `REAL_OBSERVATION`, `SYNTHETIC`, `SIMULATED`, `PREDICTED`, `INTERPOLATED`, or `DERIVED`.
- **Quality**: `GOOD`, `DEGRADED`, `SUSPECT`, or `MISSING`.
- No estimated numbers are ever presented as true sensor readings.

---

## License & Credits
Developed for **Smart India Hackathon 2026** under Problem Statement **SIH26060**.  
Sponsored by the **Ministry of Earth Sciences (MoES)** & **National Centre for Polar and Ocean Research (NCPOR)**.
