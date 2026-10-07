// Agent 4C — deterministic, versioned, auditable, isolated what-if engine.
//
// Isolation: the engine only ever receives a plain-JSON state snapshot, deep-clones
// it, and never calls a provider or writes anywhere except the (optional) AuditLog.
// Determinism: no Date.now(), no Math.random(); logical time comes from state.asOf.

import {
  COEFFS, ENGINE_VERSION, SCENARIO_SCHEMA_VERSION, SCENARIO_TYPES,
  clamp, contentHash, deepClone, round,
} from './core.js';
import { buildComparison } from './compare.js';

export class ScenarioError extends Error {
  constructor(code, message) { super(message); this.name = 'ScenarioError'; this.code = code; }
}

export function normalizeScenario(raw, state) {
  if (!raw || typeof raw !== 'object') throw new ScenarioError('INVALID_SCENARIO', 'Scenario must be an object');
  const spec = SCENARIO_TYPES[raw.type];
  if (!spec) throw new ScenarioError('UNKNOWN_TYPE', `Unknown scenario type: ${raw.type}`);
  const given = raw.params || {};
  const allowed = new Set([...Object.keys(spec.params), ...(spec.requiresAsset ? ['assetId'] : [])]);
  for (const k of Object.keys(given)) {
    if (!allowed.has(k)) throw new ScenarioError('UNKNOWN_PARAM', `Unknown parameter "${k}" for ${raw.type}`);
  }
  const params = {};
  for (const [k, p] of Object.entries(spec.params)) {
    const v = given[k] === undefined ? p.default : given[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ScenarioError('INVALID_PARAM', `${k} must be a finite number`);
    if (v < p.min || v > p.max) throw new ScenarioError('OUT_OF_RANGE', `${k}=${v} outside [${p.min}, ${p.max}]`);
    params[k] = v;
  }
  if (spec.requiresAsset) {
    const asset = (state.assets || []).find((a) => a.id === given.assetId && a.type === spec.requiresAsset);
    if (!asset) throw new ScenarioError('UNKNOWN_ASSET', `No ${spec.requiresAsset} "${given.assetId}" in station ${state.stationId}`);
    params.assetId = asset.id;
  }
  const startH = raw.startH === undefined ? 0 : raw.startH;
  if (typeof startH !== 'number' || startH < 0) throw new ScenarioError('OUT_OF_RANGE', 'startH must be >= 0');
  return { schemaVersion: SCENARIO_SCHEMA_VERSION, type: raw.type, params, startH };
}

export function simulate(state, sc, horizonH) {
  const s = deepClone(state);
  const p = sc ? sc.params : {};
  const t = sc ? sc.type : null;
  let battCap = s.energy.batteryCapacityKwh;
  let batt = s.energy.batteryKwh;
  let fuel = s.fuel.tankL;
  let resupplyAt = s.logistics.nextResupplyH;
  let resupplied = false;
  if (t === 'battery_degradation') { battCap *= 1 - p.capacityLossPct / 100; batt = Math.min(batt, battCap); }
  if (t === 'fuel_shortage') fuel *= 1 - p.lossPct / 100;
  if (t === 'resupply_delay') resupplyAt += p.delayH;

  let indoor = s.thermal.indoorC;
  let depletionH = null, fuelOutH = null;
  const timeline = [];

  for (let h = 0; h < horizonH; h++) {
    const active = !!sc && h >= sc.startH && h < sc.startH + (p.durationH ?? Infinity);
    if (!resupplied && h >= resupplyAt) { fuel += s.fuel.resupplyL || 0; resupplied = true; }

    let cap = 0;
    for (const a of s.assets) {
      if (a.type !== 'generator' || a.status === 'offline') continue;
      if (t === 'generator_failure' && active && a.id === p.assetId) continue;
      cap += a.capacityKw * (a.status === 'degraded' ? COEFFS.degradedFactor : 1);
    }
    let demand = s.energy.baseDemandKw;
    if (t === 'demand_increase' && active) demand *= 1 + p.pct / 100;
    if (t === 'temperature_drop' && active) demand += COEFFS.heatingKwPerDegC * p.deltaC;

    let out = Math.min(demand, cap);
    const need = out * COEFFS.fuelLPerKwh;
    if (fuel < need) {
      out = fuel / COEFFS.fuelLPerKwh; fuel = 0;
      if (fuelOutH === null) fuelOutH = h;
    } else fuel -= need;

    const deficit = demand - out;
    const draw = Math.min(deficit, batt);
    batt -= draw;
    const unmet = deficit - draw;
    if (depletionH === null && deficit > 1e-9 && batt <= 1e-9) depletionH = h;

    let comms = s.comms.linkQuality;
    if (t === 'comms_degradation' && active) comms *= 1 - p.qualityLossPct / 100;
    if (demand > 0 && unmet / demand > 0.5) comms *= 0.5;

    if (unmet > 1e-9) indoor -= COEFFS.indoorCoolRateCPerH * (unmet / demand);
    else if (indoor < COEFFS.indoorSetpointC) indoor = Math.min(COEFFS.indoorSetpointC, indoor + COEFFS.indoorRecoverRateCPerH);

    timeline.push({
      hour: h, demandKw: round(demand), supplyKw: round(out + draw), unmetKw: round(unmet),
      batteryKwh: round(batt), fuelL: round(fuel), indoorC: round(indoor), commsQuality: round(clamp(comms, 0, 1), 3),
      burnLph: round(out * COEFFS.fuelLPerKwh),
    });
  }

  const last = timeline[timeline.length - 1] || { fuelL: fuel, burnLph: 0, batteryKwh: batt };
  const metrics = {
    shortfallHours: timeline.filter((r) => r.unmetKw > 0.001).length,
    peakUnmetKw: round(Math.max(0, ...timeline.map((r) => r.unmetKw))),
    totalUnmetKwh: round(timeline.reduce((a, r) => a + r.unmetKw, 0)),
    batteryMinPct: battCap > 0 ? round(Math.min(...timeline.map((r) => r.batteryKwh / battCap * 100), 100)) : 0,
    batteryDepletionHour: depletionH,
    fuelEndL: round(last.fuelL),
    fuelAutonomyH: last.fuelL <= 0 ? 0 : round(Math.min(9999, last.fuelL / Math.max(last.burnLph, 0.001)), 1),
    fuelExhaustedHour: fuelOutH,
    minIndoorC: round(Math.min(...timeline.map((r) => r.indoorC))),
    minCommsQuality: round(Math.min(...timeline.map((r) => r.commsQuality)), 3),
  };
  metrics.riskScore = computeRisk(metrics, s, horizonH);
  metrics.riskLevel = riskLevel(metrics.riskScore);
  return { timeline, metrics };
}

export function computeRisk(m, state, horizonH) {
  const demandBudget = Math.max(state.energy.baseDemandKw * horizonH * 0.1, 1);
  const power = Math.min(1, m.totalUnmetKwh / demandBudget) * 30;
  const battery = (1 - clamp(m.batteryMinPct, 0, 100) / 100) * 15;
  const fuel = m.fuelAutonomyH < 24 ? (1 - m.fuelAutonomyH / 24) * 20 : 0;
  const thermal = m.minIndoorC < 10 ? Math.min(1, (10 - m.minIndoorC) / 20) * 25 : 0;
  const comms = (1 - clamp(m.minCommsQuality, 0, 1)) * 10;
  return Math.round(clamp(power + battery + fuel + thermal + comms, 0, 100));
}
export const riskLevel = (score) => (score < 25 ? 'low' : score < 50 ? 'moderate' : score < 75 ? 'high' : 'critical');

export function baselineMetrics(state, horizonH = 24) { return simulate(state, null, horizonH).metrics; }

export class AuditLog {
  #records = [];
  record(rec) { this.#records.push(Object.freeze(deepClone(rec))); return rec.id; }
  list() { return this.#records.map(deepClone); }
  get(id) { const r = this.#records.find((x) => x.id === id); return r ? deepClone(r) : null; }
  /** Re-executes a stored run from its recorded inputs and checks the result hash. */
  verify(id) {
    const r = this.#records.find((x) => x.id === id);
    if (!r) return { ok: false, reason: 'not_found' };
    const again = runScenario(r.inputSnapshot, r.scenario, { horizonH: r.horizonH });
    return { ok: again.resultHash === r.resultHash, expected: r.resultHash, actual: again.resultHash };
  }
}

export function runScenario(state, rawScenario, { horizonH, auditLog } = {}) {
  const scenario = normalizeScenario(rawScenario, state);
  const spec = SCENARIO_TYPES[scenario.type];
  const horizon = horizonH ?? spec.defaultHorizonH;
  const inputSnapshot = deepClone(state);

  const baseline = simulate(inputSnapshot, null, horizon);
  const result = simulate(inputSnapshot, scenario, horizon);
  const comparison = buildComparison({ baseline, result, scenario, state: inputSnapshot });

  const inputHash = contentHash({ engine: ENGINE_VERSION, state: inputSnapshot, scenario, horizon });
  const run = {
    id: `sc_${inputHash}`,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    stationId: state.stationId,
    asOf: state.asOf, // logical time only
    scenario, horizonH: horizon, inputHash,
    baseline, result, comparison,
  };
  run.resultHash = contentHash({ baseline, result, comparison });
  if (auditLog) auditLog.record({ ...run, inputSnapshot });
  return run;
}
