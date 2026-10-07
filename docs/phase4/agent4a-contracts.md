# Agent 4A — Living Digital Twin Runtime & Infrastructure Contracts

This document specifies the stable contracts, event schemas, runtime snapshot interfaces, dependency graph evaluation shapes, alert lifecycles, and security contexts established by **Agent 4A** on branch `feat/phase4a-twin-runtime`.

These contracts are consumed directly by:
- **Agent 4B (ML / Intelligence)**: reads historical telemetry points, channel watermarks, and twin states for forecasting and anomaly detection.
- **Agent 4C (Decision Layer)**: consumes `TwinState` (§2) via `GET /api/v1/runtime/{station_id}/state`, operational events, and What-If perturbation impacts.
- **Agent 3 (Integration & Hardening)**: reconciliation anchor across database schema, API contracts, and integration pipelines.

---

## 1. Canonical Telemetry Event Schema

Edge sensors and causal simulators emit `TelemetryEvent` instances over MQTT or HTTP ingestion.

```json
{
  "event_id": "sim-maitri-aws-1-air_temp_c-1791374400",
  "station_id": "maitri",
  "asset_id": "maitri.aws-1",
  "channel_id": "maitri.aws-1.air_temp_c",
  "metric": "air_temp_c",
  "unit": "degC",
  "observed_at": "2026-10-07T12:00:00Z",
  "value": -18.42,
  "provenance": "SYNTHETIC",
  "quality": "GOOD",
  "source": "sim:causal:v1",
  "sequence_num": 142
}
```

### Invariants:
1. `provenance` must be one of: `REAL_OBSERVATION`, `SYNTHETIC`, `DERIVED`, `PREDICTED`, `SIMULATED`, `SCENARIO`.
2. `quality` must be one of: `GOOD`, `SUSPECT`, `BAD`, `MISSING`.
3. If `quality == "MISSING"`, `value` must be `null`. If `quality != "MISSING"`, `value` must be finite (never `null`, `NaN`, or `Inf`).
4. Deduplication natural key: `(channel_id, observed_at, provenance, source)`. Same key + same value = `DUPLICATE` (dropped); same key + different value = `CONFLICT` (rejected, never overwrites).

---

## 2. Twin State Snapshot (Agent 4C Contract §1)

Exposed at `GET /api/v1/runtime/{station_id}/state`. Provides the exact JSON schema defined in `agent4c-contracts.md` §1:

```json
{
  "stationId": "maitri",
  "asOf": "2026-10-07T12:00:00Z",
  "assets": [
    {
      "id": "maitri.dg-1",
      "type": "generator",
      "status": "online",
      "capacityKw": 125.0,
      "loading": 48.2
    },
    {
      "id": "maitri.dg-2",
      "type": "generator",
      "status": "online",
      "capacityKw": 125.0,
      "loading": 24.1
    },
    {
      "id": "maitri.dg-3",
      "type": "generator",
      "status": "online",
      "capacityKw": 125.0,
      "loading": 12.0
    }
  ],
  "energy": {
    "baseDemandKw": 76.5,
    "batteryKwh": 120.0,
    "batteryCapacityKwh": 150.0
  },
  "fuel": {
    "tankL": 315000.0,
    "resupplyL": 450000.0,
    "burnLph": 32.4
  },
  "logistics": {
    "nextResupplyH": 2880,
    "daysOfAutonomy": 120.5
  },
  "thermal": {
    "indoorC": 21.0,
    "heatingDemandKw": 98.4
  },
  "comms": {
    "linkQuality": 0.95
  },
  "environment": {
    "outdoorC": -18.42,
    "windMs": 9.2
  },
  "risk": {
    "score": 14.5,
    "nMinusOneMarginPct": 69.4
  },
  "alerts": [
    {
      "id": "alt-8f2a1b",
      "severity": "warning",
      "category": "logistics",
      "message": "Low Fuel Autonomy Warning: Fuel autonomy is 84.2 days"
    }
  ]
}
```

---

## 3. Dependency Graph Evaluation & Causal Impact

Exposed at `GET /api/v1/runtime/{station_id}/dependency-graph` and `POST /api/v1/runtime/{station_id}/perturb`.

### Causal Chain Order:
`ENVIRONMENT` → `HEATING` → `ENERGY` → `GENERATORS` → `FUEL` → `INVENTORY` → `LOGISTICS` → `RISK`

### Perturbation Impact Result (`ImpactResult`):
When a scenario injects a fault or weather change (e.g. `air_temp_c = -35.0` or `dg-1.status = offline`), `POST /api/v1/runtime/{station_id}/perturb` returns:

```json
{
  "perturbation": {
    "maitri.env.air_temp_c": -35.0
  },
  "rows": [
    {
      "node_id": "maitri.heating.demand_kw",
      "domain": "HEATING",
      "unit": "kW",
      "baseline": 74.2,
      "perturbed": 128.6,
      "delta": 54.4,
      "pct_change": 73.315,
      "path": ["maitri.env.air_temp_c", "maitri.heating.demand_kw"]
    },
    {
      "node_id": "maitri.fuel.burn_rate_lph",
      "domain": "FUEL",
      "unit": "L/h",
      "baseline": 28.5,
      "perturbed": 41.2,
      "delta": 12.7,
      "pct_change": 44.561,
      "path": ["maitri.env.air_temp_c", "maitri.heating.demand_kw", "maitri.fuel.burn_rate_lph"]
    },
    {
      "node_id": "maitri.logistics.days_of_autonomy",
      "domain": "LOGISTICS",
      "unit": "d",
      "baseline": 115.0,
      "perturbed": 79.6,
      "delta": -35.4,
      "pct_change": -30.783,
      "path": ["maitri.env.air_temp_c", "maitri.heating.demand_kw", "maitri.fuel.burn_rate_lph", "maitri.fuel.burn_rate_kld", "maitri.logistics.days_of_autonomy"]
    }
  ]
}
```

---

## 4. Alert & Event Lifecycle Schema

### Alert Lifecycle:
1. `OPEN`: Triggered when rule threshold or dependency condition is met.
2. `ACKNOWLEDGED`: Operator recorded acknowledgement note with timestamp and user ID.
3. `RESOLVED`: Condition cleared for at least one evaluation cycle.

```json
{
  "id": "alt-7a2e8c14",
  "station_id": "maitri",
  "rule_id": "rule:autonomy:reserve",
  "title": "Low Fuel Autonomy Warning",
  "message": "Fuel autonomy has fallen to 68.4 days (below 90-day threshold).",
  "severity": "WARNING",
  "state": "OPEN",
  "source": "DEPENDENCY",
  "domain": "LOGISTICS",
  "recommended_action": "Review diesel generator dispatch and optimize building heating loops to conserve bulk fuel.",
  "raised_at": "2026-10-07T12:00:00Z",
  "acknowledged_at": null,
  "acknowledged_by": null,
  "resolved_at": null,
  "occurrences": 1
}
```

### Operational Event Log (`TwinEvent`):
Append-only log of system transitions (`ALERT_RAISED`, `ALERT_ESCALATED`, `ALERT_ACKNOWLEDGED`, `ALERT_RESOLVED`, `TELEMETRY_GAP_OPENED`, `BUFFER_FLUSHED`, `PERTURBATION_APPLIED`).

---

## 5. Security & RBAC Context

### RBAC Roles:
| Role | Permissions |
|---|---|
| `VIEWER` | `twin:read`, `telemetry:read`, `alerts:read`, `runtime:read` |
| `STATION_OPERATOR` | `VIEWER` + `alerts:acknowledge` (assigned station), `telemetry:ingest` |
| `HQ_MOES` | `VIEWER` + `alerts:acknowledge` (all stations), `telemetry:ingest`, `audit:read` |
| `SYSTEM_ADMIN` | All permissions + `runtime:control`, `perturbation:apply` |

### Bearer Token Payload (HS256):
```json
{
  "sub": "operator.maitri.01",
  "roles": ["STATION_OPERATOR"],
  "stations": ["maitri"],
  "iat": 1791374400,
  "exp": 1791403200,
  "iss": "polartwin",
  "aud": "polartwin-api"
}
```

---

## 6. Tamper-Evident Audit Trail

Every mutating action (`PERTURBATION_APPLIED`, `ALERT_ACKNOWLEDGED`, `RUNTIME_CONTROL`) is recorded in `audit_events`.
Each record includes `hash` computed over:
`SHA-256(prev_hash, occurred_at, actor_id, action, resource_type, resource_id, outcome, details)`

`GET /api/v1/audit` returns `chain_intact: true` when all hashes in the historical sequence match cryptographically.
