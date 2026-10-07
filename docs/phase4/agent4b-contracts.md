# Agent 4B — Intelligence Contracts

Agent 4C consumes 4B **only** through `createIntelligenceService(...)` (or an HTTP wrapper with identical payloads). No ML internals are imported. All payloads are plain JSON.

> **Status:** written without access to the Polar-Twin backend source. The service reads telemetry and twin state through two provider interfaces (§1). If 4A's real shapes differ, adapt at the provider boundary, not inside the models.

## 0. Common envelope (every output)

| field | meaning |
|---|---|
| `kind` | `forecast \| anomalies \| maintenance \| risk \| recommendations \| logistics` |
| `stationId`, `asOf`, `generatedAt` | `asOf` = logical time of the data; models never read the wall clock |
| `model` | `{ name, version }` |
| `inputWindow` | `{ from, to, points, rawMissingFraction, imputedPoints }` where applicable |
| `confidence` | 0..1, a **heuristic** data-sufficiency/error score, *not* a calibrated probability |
| `provenance` | one of `REAL_OBSERVATION, SYNTHETIC, DERIVED, PREDICTED, SIMULATED, SCENARIO` |
| `inputProvenance` | provenance of the telemetry the output was computed from |

Provenance rules: forecasts and maintenance/logistics projections are `PREDICTED`; anomaly detections, risk and recommendations are `DERIVED` (risk factors individually tagged). Outputs live in a separate prediction store with **no API to write twin state**.

## 1. Provider interfaces consumed

```
telemetry.getTelemetry(stationId, { metric, from, to }) -> { points:[{ts,value}], provenance? }
twin.getState(stationId, { asOf })                       -> TwinState   (shape in agent4c-contracts.md §1)
```
Metric names: `demandKw, outdoorC, activity, windMs, pressureHpa, fuelL, commsLatencyMs, commsPacketLoss, <assetId>.loading, <assetId>.exhaustTempC, <assetId>.specificFuelLPerKwh`. A metric with no points is "missing" and is skipped and reported — never fabricated.

## 2. Service methods (the 4C-facing contract)

```
getForecast(stationId, { metric='demandKw'|'outdoorC'|'fuelL', horizonH (1..168), asOf }) -> Forecast
getAnomalies(stationId, { asOf, windowH=24 })        -> Anomaly[]            (getAnomaliesDetailed adds `skipped`)
getMaintenance(stationId, { asOf })                  -> MaintenancePrediction[]   (status 'ok' only; Detailed includes insufficient_data)
getRisk(stationId, { asOf })                         -> Risk
getRecommendations(stationId, { asOf })              -> { recommendations: Recommendation[], riskScore, unavailableInputs }
getLogistics(stationId, { asOf })                    -> Logistics
```
Errors are `IntelligenceError` with `code` ∈ `INSUFFICIENT_DATA | INVALID_HORIZON | TELEMETRY_UNAVAILABLE | UNSUPPORTED_METRIC | UNEXPLAINED_RECOMMENDATION`. 4C treats any thrown error as *unavailable*.

## 3. Schemas

**Forecast**
```
{ kind:'forecast', metric, unit, horizonH, asOf,
  points:[{ offsetH (>=1), ts, value, lower, upper }],          // strictly after asOf; never includes observed values
  model, inputWindow:{..., trainingRows}, confidence,
  uncertainty:{ method:'gaussian-residual', level:0.8, sigma, note },
  drivers:{ temperatureKwPerDegC|null, activityKwPerUnit|null }|null,
  assumptions:[string], selection?:{ model, reason, backtest }, 
  fallback: null | { used:true, reason, code, attempted },
  provenance:'PREDICTED', inputProvenance }
```
**Anomaly**
```
{ assetId, channel, metric, kind:'equipment'|'environment', ts, severity:'warning'|'critical',
  observed, expected, expectedRange:{low,high}, zScore, confidence, score(=confidence), unit,
  model, reason, provenance:'DERIVED', inputProvenance }
```
**MaintenancePrediction**
```
{ kind:'maintenance', assetId, assetType, status:'ok'|'insufficient_data',
  healthIndex (0..100)|null, healthTrajectory:[{offsetDays,healthIndex}], failureRisk30d (0..0.9)|null, riskNote,
  urgency:'routine'|'soon'|'urgent'|'unknown', daysToCritical|null, dueInDays, recommendedInspection, action(alias),
  indicators:[{indicator,level,slopePerDay,r2,days,daysToCritical}], usedIndicators, missingIndicators:[{indicator,reason}],
  confidence, reason, model, provenance:'PREDICTED' }
```
`failureRisk30d` is a bounded heuristic index, **not** a calibrated probability.

**Risk**
```
{ kind:'risk', score 0..100|null, severity|level:'low'|'moderate'|'high'|'critical'|'unknown', trend:'rising'|'falling'|'stable'|'unknown',
  confidence, domainsWithEvidence,
  domains:{ energy|infrastructure|logistics|environment|equipment: { score|null, severity, factors[] } },
  factors:[{ domain,id,label,risk,confidence,effective,evidence,provenance,source }],   // sorted by effective contribution
  drivers:[label], unavailableInputs:[{input,code,message}], model, provenance:'DERIVED' }
```
Scoring: domain = 100·(1 − Π(1 − effective_i)); effective = risk × confidence (observed state confidence = 1). Station = round(0.6·max + 0.4·mean) over domains **with evidence**. A domain with no evidence is `unknown`, never `low`. Score is exactly reproducible from `factors`.

**Recommendation**
```
{ id, type:'load_reduction'|'fuel_conservation'|'energy_redistribution'|'heating_adjustment'|'resupply_timing'|'maintenance_inspection',
  priority (1 = most urgent), action,
  why:[{ claim, evidence:[{ ref, name, value, unit?, provenance, ts? }] }],      // required, non-empty
  quantified: object|null,                                                         // arithmetic on evidence only
  confidence, provenance, model, asOf }
```
**Logistics**
```
{ kind:'logistics', status:'ok'|'no_consumption', levelL, burnLph, burnLphStdErr, daysOfAutonomy,
  depletion:{ ts, earliestTs, latestTs, level:0.8 },
  resupplyRisk:{ level:'low'|'moderate'|'high'|'critical'|'unknown', marginHours, earliestMarginHours, safetyMarginH, etaTs, reason }, confidence, model, provenance:'PREDICTED' }
```

## 4. Behaviour guarantees

- **Deterministic:** same inputs → identical outputs; no randomness or wall-clock in models.
- **Insufficient data:** forecast needs ≥72 valid hourly points (24 h) / ≥336 (7 d); >30% *raw* missing, stale history, or <48 complete training rows → `INSUFFICIENT_DATA`. Interpolation (gaps ≤6 h) is reported in `inputWindow` and does not hide sparsity. Anomaly detection needs ≥72 points per channel; maintenance needs ≥5 days per indicator.
- **Fallback:** improved model fails → seasonal-naive baseline with `fallback.used=true`. Baseline also impossible → error, never invented numbers. `forecastDemandAuto` only uses the improved model if it won a walk-forward backtest on that station's history.
- **Partial evidence:** `getRisk`/`getRecommendations` still run if some inputs fail and list them in `unavailableInputs`.
- **No sensor invention:** maintenance uses only supplied indicators; absent ones are listed in `missingIndicators`.

## 5. Assumptions / placeholders to calibrate

Indicator nominal/critical levels (`INDICATOR_SPECS`), anomaly thresholds (`THRESHOLDS`: warn 3.5, critical 6 robust σ), risk factor mappings, degraded-generator factor 0.6, and the 10% burn-rate uncertainty floor are **assumed defaults**, not fitted to Maitri/Bharati data.
