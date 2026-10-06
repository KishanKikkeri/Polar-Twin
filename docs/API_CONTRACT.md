# POLARTWIN API Contract & Data Architecture (v1)

## Overview

The POLARTWIN backend provides the authoritative data foundation and Digital Twin read models for India's Antarctic Research Stations (**Maitri** and **Bharati**).

---

## 1. Core Principles

1. **Explicit Provenance:** Every telemetry reading specifies where it came from.
   - `REAL_OBSERVATION`: Physical sensor on station. (None exist in this prototype).
   - `SYNTHETIC`: Generated stand-in for an observation.
   - `DERIVED`: Computed deterministically from observation-class inputs.
   - `PREDICTED`: Model forecast or extrapolation.
   - `SIMULATED`: Physics/process simulation output.
   - `SCENARIO`: What-if simulation output.

2. **No Coercion of Missing Data:**
   - Missing data is represented as `quality: "MISSING"` and `value: null`.
   - Missing values are **never silently converted to `0`**.
   - A database check constraint enforces `(quality = 'MISSING' AND value IS NULL) OR (quality != 'MISSING' AND value IS NOT NULL)`.

3. **Separation of Raw Telemetry and Twin State:**
   - `telemetry_readings` is strictly append-only.
   - The Digital Twin Overview (`/overview`) is a dynamic **read model** computed over raw telemetry at reference time `as_of`.
   - Predictions and simulations **never overwrite or substitute observed state**. Predictions appear in `next_prediction`.

4. **Timezone Awareness:**
   - All timestamps are UTC ISO 8601 strings (e.g. `2026-10-06T12:00:00Z`).
   - Query filters (`start`, `end`, `as_of`) strictly reject naive datetimes with HTTP 422.

5. **Uniform Error Envelope:**
   All non-2xx responses adhere to the standard envelope:
   ```json
   {
     "error": {
       "code": "STATION_NOT_FOUND",
       "message": "Station 'vostok' does not exist",
       "details": {
         "station_id": "vostok",
         "known_station_ids": ["bharati", "maitri"]
       }
     }
   }
   ```

---

## 2. API Endpoints

### 2.1 Health Check
- **Path:** `GET /health`
- **Status:** 200 (healthy) or 503 (database degraded)
- **Response:**
  ```json
  {
    "status": "ok",
    "service": "POLARTWIN Digital Twin API",
    "version": "0.1.0",
    "environment": "development",
    "time": "2026-10-06T12:00:00Z",
    "database": {
      "status": "ok",
      "detail": null
    }
  }
  ```

### 2.2 Stations List
- **Path:** `GET /api/v1/stations`
- **Response (Array of Stations):**
  ```json
  [
    {
      "id": "bharati",
      "station_id": "bharati",
      "name": "Bharati Research Station",
      "station_name": "Bharati Research Station",
      "short_name": "Bharati",
      "status": "operational",
      "location": "Larsemann Hills, Prydz Bay, East Antarctica",
      "region": "North Grovnes Island, between Thala Fjord and Quilty Bay",
      "operator": "National Centre for Polar and Ocean Research (NCPOR)",
      "established_year": 2012,
      "latitude": -69.4082,
      "longitude": 76.1874,
      "coordinates": { "lat": -69.4082, "lon": 76.1874 }
    },
    {
      "id": "maitri",
      "station_id": "maitri",
      "name": "Maitri Research Station",
      "station_name": "Maitri Research Station",
      "short_name": "Maitri",
      "status": "operational",
      "location": "Schirmacher Oasis, Queen Maud Land, Antarctica",
      "region": "Central Dronning Maud Land",
      "operator": "National Centre for Polar and Ocean Research (NCPOR)",
      "established_year": 1989,
      "latitude": -70.7653,
      "longitude": 11.7358,
      "coordinates": { "lat": -70.7653, "lon": 11.7358 }
    }
  ]
  ```

### 2.3 Station Detail
- **Path:** `GET /api/v1/stations/{station_id}`
- **Parameters:** `station_id` (e.g. `maitri`, `bharati`)
- **Response:** Station metadata including `station_id`, `station_name`, `status`, `coordinates`, `buildings` (with codes matching frontend 3D objects), `asset_count`, `channel_count`, and `updated_at`.

### 2.4 Digital Twin Overview
- **Path:** `GET /api/v1/stations/{station_id}/overview`
- **Query Parameters:**
  - `as_of` *(optional, ISO 8601 aware datetime)*: Replay the twin state as it was at that exact time.
- **Response Structure:**
  - `station_id`: Station ID string (`"maitri"`)
  - `station_name`: Full station name
  - `status`: `"operational"`, `"degraded"`, `"offline"`, or `"unknown"`
  - `last_updated`: Latest observation timestamp (ISO 8601 UTC)
  - `data_status`: `"REAL_OBSERVATION"` or `"SYNTHETIC"`
  - `domains`:
    - `environment`: `{ air_temperature, wind, indoor_temperature, co2_ppm }`
    - `energy`: `{ total_load_kw, voltage_v, frequency_hz, fuel_storage_pct }`
    - `logistics`: `{ fuel_days_of_autonomy, water_storage_pct, waste_storage_pct }`
    - `infrastructure`: `{ boiler_supply_temp_c, satellite_latency_ms, satellite_bandwidth_mbps }`
  - `active_alerts`: List of active threshold alerts (`[ { alert_id, source, severity, title, description, created_at, status } ]`)
  - `risk`: `{ score, severity, contributing_factors, trend }`
  - `condition`: Station condition (`NORMAL`, `WARNING`, `CRITICAL`, `UNKNOWN`)
  - `completeness`: `COMPLETE`, `PARTIAL`, `NO_DATA`
  - `contains_real_observations`: Boolean (`false` for prototype)
  - `data_notice`: Explanatory notice when real observations are absent
  - `counts`: Aggregate totals by freshness, condition, quality, and provenance
  - `systems`: System summaries
  - `assets`: Asset list with channels, freshness (`FRESH`, `STALE`, `MISSING`), latest value, and predictions

### 2.5 Station Assets
- **Path:** `GET /api/v1/stations/{station_id}/assets`
- **Query Parameters:**
  - `system` *(optional)*: Filter by `ELECTRICITY`, `FUEL`, `WATER`, `HEATING`, `COMMUNICATION`, `WASTE`, `ENVIRONMENT`, `WEATHER`
  - `building_id` *(optional)*: Filter by parent building
- **Response:** Array of `Asset` objects. Each asset's `building_id` matches the 3D scene building code (e.g. `"power-house"`, `"fuel-farm"`) so the 3D scene and Asset Inspector link seamlessly.

### 2.6 Raw Telemetry Query
- **Path:** `GET /api/v1/stations/{station_id}/telemetry`
- **Query Parameters:**
  - `range` *(optional)*: `1h`, `6h`, `24h`, `7d`, `30d` (anchored to observed timeline)
  - `parameter` *(optional)*: Metric name alias (e.g. `air_temp_c`)
  - `asset_id` *(optional)*: e.g. `maitri.dg-1`
  - `metric` *(optional)*: e.g. `load_kw`
  - `provenance` *(optional, repeatable)*: e.g. `?provenance=SYNTHETIC&provenance=PREDICTED`
  - `quality` *(optional, repeatable)*: `GOOD`, `SUSPECT`, `BAD`, `MISSING`
  - `start`, `end` *(optional, ISO 8601 aware datetimes)*
  - `order` *(optional)*: `desc` (default) or `asc`
  - `limit` *(optional)*: default 500, max 5000
  - `offset` *(optional)*: default 0
- **Response:** Array of `TelemetryReading` / `TelemetryPoint` objects.
