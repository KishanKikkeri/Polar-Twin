# Agent 4C — Contracts

Agent 4C (decision layer) consumes Agent 4A (twin runtime) and Agent 4B (ML) **only** through the interfaces below. 4C does not reimplement dependency propagation, forecasting, or anomaly detection. Dev mocks live in `src/decision/adapters.js` and must be replaced by (or wrapped around) real services with the same shapes.

> **Status:** these shapes were defined from the Phase 4 brief, not from 4A/4B source. When 4A/4B publish their real schemas, reconcile here first. Field names that differ should be fixed in a thin adapter, not inside 4C modules.

## 1. Twin provider (Agent 4A)

All reads are `as_of` aware. Omitting `asOf` means "current"; **replay always passes `asOf`**.

```
getState(stationId, { asOf? })            -> TwinState
getEvents(stationId, { from, to })        -> Event[]          // optional; replay degrades gracefully
getTelemetry(stationId, { metric, from, to }) -> { metric, points: [{ts, value}] }   // optional
```

```
TwinState {
  stationId, asOf (ISO-8601),
  assets: [{ id, type: 'generator'|'medical'|'comms'|'water'|'lab'|..., status: 'online'|'degraded'|'offline', capacityKw? }],
  energy:   { baseDemandKw, batteryKwh, batteryCapacityKwh },
  fuel:     { tankL, resupplyL },
  logistics:{ nextResupplyH },
  thermal:  { indoorC },
  comms:    { linkQuality (0..1) },
  environment: { outdoorC, windMs },
  alerts:   [{ id, severity: 'info'|'warning'|'critical', category, message }]
}
Event { ts, type, severity, message }
```

Failure contract: throw an error with `code` (e.g. `DEPENDENCY_UNAVAILABLE`). 4C surfaces it as *unavailable* and never substitutes data.

## 2. Prediction provider (Agent 4B)

```
getForecast(stationId, { metric, horizonH, asOf? }) -> { metric, points: [{offsetH, value}], model: {name, version} }
getAnomalies(stationId, { asOf? })                  -> [{ assetId, metric, severity, score, ts, model }]
getMaintenance(stationId, { asOf? })                -> [{ assetId, action, dueInDays, failureRisk30d (heuristic index, not a probability; legacy alias failureProbability accepted), model }]
getRisk(stationId, { asOf? })                       -> { score, level, drivers[], model }
```

Failure contract: same as above. If `getRisk` is down, the Copilot falls back to the **local scenario-engine baseline** and labels it "not an ML prediction". Forecast/anomaly/maintenance have no fallback.

## 3. Scenario engine (4C-owned)

```
runScenario(state, scenario, { horizonH?, auditLog? }) -> ScenarioRun
scenario = { type, params, startH? }      // see SCENARIO_TYPES in core.js for params/ranges/defaults
types: temperature_drop | generator_failure | battery_degradation | demand_increase
       | fuel_shortage | resupply_delay | comms_degradation
ScenarioRun { id: 'sc_<inputHash>', engineVersion, schemaVersion, stationId, asOf, scenario, horizonH,
              inputHash, resultHash, baseline:{timeline,metrics}, result:{timeline,metrics}, comparison }
comparison = { rows:[{metric,label,unit,baseline,scenario,absDiff,pctDiff|null,direction}],
               affectedSystems, riskImpact:{baseline,scenario,delta,levelChanged}, recommendations:[{priority,action,reason,metricRef}] }
```

Guarantees: deterministic (no clock/random), versioned (`ENGINE_VERSION` bump required on any coefficient change), auditable (`AuditLog.record/verify` re-executes and compares `resultHash`), isolated (input deep-cloned; engine has no provider access and no write path besides the audit log). `pctDiff` is `null` when the baseline is 0.

Errors: `ScenarioError` with `code` ∈ `UNKNOWN_TYPE | UNKNOWN_PARAM | INVALID_PARAM | OUT_OF_RANGE | UNKNOWN_ASSET | INVALID_SCENARIO`.

## 4. Natural-language what-if

`parseScenario(text, state?) -> { ok:true, scenario, assumptions[], parser } | { ok:false, code, message, supported[] }`
Rule-based, deterministic. Defaulted parameters are listed in `assumptions`. No guess is ever returned for unknown assets or unmatched text.

## 5. Replay

`createReplay({ provider, stationId, from, to, stepMs }) -> { range, steps, frameAt(at), telemetryUpTo(at, metric, windowMs) }`
`frameAt` → `{ available, asOf, state, events, warnings }`. `replayReducer(state, action)` is a pure controller (`seek | step | play | pause | speed | tick`); the UI owns the timer.

## 6. Emergency Mode & station comparison

`buildEmergencyView(state) -> { priorities[6], pinnedCritical[] }` in fixed order: critical_power, heating, communications, medical, fuel, infrastructure. Critical alerts and critical-status categories are always in `pinnedCritical`; `filterEmergencyAlerts` can never remove them. Threshold table: `THRESHOLDS` in `emergency.js`.
`compareStations(stateA, stateB) -> { ok, rows[{dimension,metric,label,unit,a,b,diff,better}] } | { ok:false, missing[] }`.

## 7. Copilot tool contract

`createCopilot({ twin, predictions, auditLog }).ask(question, { stationId, asOf }) -> { status, answer, facts[], sources[] , run? }`
`status` ∈ `ok | unavailable | unsupported | clarify | not_found`. Every `fact` = `{ key, label, value, unit, display, source:{tool, asOf, model?} }`. Answer text is rendered only from facts; `assertGrounded(response)` verifies that every number in the text appears in a fact.

## Known gaps to reconcile with 4A/4B

- Real `TwinState` is likely richer (per-asset telemetry, dependency graph). 4C reads only the fields above.
- Engine coefficients (`COEFFS`) are placeholders, not station-calibrated.
- If 4A already exposes a risk/propagation simulator, `simulate()` should be wrapped or replaced behind the same `ScenarioRun` shape rather than run in parallel.
