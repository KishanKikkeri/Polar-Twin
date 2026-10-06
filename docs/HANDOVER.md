# POLARTWIN — Agent 1 & Agent 2 Integrated Handover Note

**Branch:** `feat/backend-twin-core`  
**Problem Statement:** SIH26060 — Digital Platform for efficient remote management of Indian Antarctic Research Stations (Maitri & Bharati)

---

## 1. Overview of Delivered Integration

We have extracted and merged the frontend integration bundle (`feat/frontend-twin-integration`) into our backend branch (`feat/backend-twin-core`) and harmonized the contracts so that the React/Three.js frontend and the FastAPI backend communicate end-to-end.

### What Was Integrated:
1. **Frontend Integration Bundle:**
   - Typed API client in [`src/services/api/client.js`](file:///d:/Projects/Polar-Twin/src/services/api/client.js) with timeout, abort, and error classification.
   - Pure twin logic in [`src/services/twin/`](file:///d:/Projects/Polar-Twin/src/services/twin/): provenance, quality, freshness, severity adapters, and 3D asset mapping.
   - Frontend components: [`StationOverviewCard.jsx`](file:///d:/Projects/Polar-Twin/src/components/ui/StationOverviewCard.jsx), [`AssetInspector.jsx`](file:///d:/Projects/Polar-Twin/src/components/dashboard/AssetInspector.jsx), [`DataBadges.jsx`](file:///d:/Projects/Polar-Twin/src/components/ui/DataBadges.jsx), and hooks [`useStationTwin.js`](file:///d:/Projects/Polar-Twin/src/hooks/useStationTwin.js), [`useBackendStations.js`](file:///d:/Projects/Polar-Twin/src/hooks/useBackendStations.js).
2. **Backend Contract Alignment:**
   - List endpoints (`/api/v1/stations`, `/api/v1/stations/{id}/assets`, `/api/v1/stations/{id}/telemetry`) return JSON arrays matching frontend expectations.
   - Aliased fields for smooth consumption: `station_id` alongside `id`, `station_name` alongside `name`, `latitude`/`longitude` alongside `coordinates`.
   - Asset `building_id` stripped to match local 3D building object codes (`power-house`, `fuel-farm`, etc.), enabling immediate 3D-to-backend linkage in the UI.
   - Full `domains` payload (`environment`, `energy`, `logistics`, `infrastructure`), `active_alerts`, and `risk` score populated dynamically from the twin read model.
   - Telemetry queries support `range` (`1h`, `6h`, `24h`, `7d`, `30d`) and `parameter` aliases.

---

## 2. Verification & Test Results

Both test suites run independently and pass 100%:

### Backend Test Suite (Pytest)
```bash
pytest .\backend\tests -v
======================== 51 passed in 2.00s ========================
```
Covers:
- Database CHECK constraints (MISSING quality requires NULL value, non-missing requires non-null)
- Alembic migration upgrade & downgrade lifecycles
- Seed repeatability and idempotency
- Station and asset topology queries
- Digital Twin overview read model, condition rollups, freshness evaluation
- Provenance separation (predictions and simulations never overwrite observed state)

### Frontend Test Suite (Node.js Built-in Runner)
```bash
npm test
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
```
Covers:
- URL construction and parameter handling
- Error categorization (`network`, `timeout`, `aborted`, `http`, `parse`, `invalid-request`)
- Fallback to labelled simulated state when backend is offline
- Freshness, provenance, and severity mappings
- Asset grouping by 3D object ID

---

## 3. How to Run Locally

### Start the Backend (Terminal 1)
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate    # or: source .venv/bin/activate
pip install -r requirements-dev.txt

# Run migrations & seed data
alembic upgrade head
python -m app.seed

# Start FastAPI server
uvicorn app.main:app --reload --port 8000
```

### Start the Frontend (Terminal 2)
```bash
# In repository root:
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The frontend connects directly to [http://localhost:8000](http://localhost:8000).
- Station Selector displays `BACKEND · OPERATIONAL` for Maitri and Bharati.
- 3D Station View shows the Twin Overview Card with live backend status, freshness, and domain breakdowns.
- Selecting 3D buildings (e.g. Power House) displays linked backend assets and operational status in the Asset Inspector.
- If the backend is stopped, the frontend smoothly degrades to clearly-labelled local simulation without crashing.
