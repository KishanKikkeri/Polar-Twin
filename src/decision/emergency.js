// Agent 4C — Emergency Mode prioritisation and Maitri-vs-Bharati station comparison.
// Pure functions over twin-state snapshots; thresholds are explicit and exported.

import { batteryPct, fuelAutonomyH, generators, onlineCapacityKw, round } from './core.js';
import { baselineMetrics } from './scenarioEngine.js';

export const EMERGENCY_ORDER = Object.freeze(['critical_power', 'heating', 'communications', 'medical', 'fuel', 'infrastructure']);
const LABELS = { critical_power: 'Critical power', heating: 'Heating', communications: 'Communications', medical: 'Medical / critical loads', fuel: 'Fuel', infrastructure: 'Other essential infrastructure' };
export const THRESHOLDS = Object.freeze({
  battery: { critical: 25, warning: 50 }, indoorC: { critical: 5, warning: 12 },
  comms: { critical: 0.3, warning: 0.6 }, fuelH: { critical: 24, warning: 72 },
});
const rank = (cat) => { const i = EMERGENCY_ORDER.indexOf(cat); return i < 0 ? EMERGENCY_ORDER.length - 1 : i; };
const low = (v, t) => (v < t.critical ? 'critical' : v < t.warning ? 'warning' : 'ok');
const worst = (...s) => (s.includes('critical') ? 'critical' : s.includes('warning') ? 'warning' : s.includes('unknown') ? 'unknown' : 'ok');

export function buildEmergencyView(state, { alerts = state.alerts || [] } = {}) {
  const assets = state.assets || [];
  const cap = onlineCapacityKw(state), demand = state.energy.baseDemandKw, bPct = batteryPct(state);
  const powerStatus = generators(state).every((g) => g.status === 'offline') ? 'critical'
    : cap < demand ? worst(low(bPct, THRESHOLDS.battery), 'warning') : cap < demand * 1.1 ? 'warning' : low(bPct, THRESHOLDS.battery) === 'critical' ? 'warning' : 'ok';
  const med = assets.filter((a) => a.type === 'medical');
  const medStatus = !med.length ? 'unknown' : med.some((a) => a.status === 'offline') ? 'critical' : med.some((a) => a.status === 'degraded') ? 'warning' : 'ok';
  const other = assets.filter((a) => !['generator', 'medical', 'comms', 'battery'].includes(a.type));
  const offlineOther = other.filter((a) => a.status === 'offline'), degradedOther = other.filter((a) => a.status === 'degraded');
  const commsAsset = assets.filter((a) => a.type === 'comms');
  const commsStatus = worst(low(state.comms.linkQuality, THRESHOLDS.comms), commsAsset.some((a) => a.status === 'offline') ? 'critical' : 'ok');
  const aut = fuelAutonomyH(state);

  const status = {
    critical_power: { status: powerStatus, detail: `Online capacity ${round(cap, 0)} kW vs demand ${demand} kW; battery ${round(bPct, 0)}%` },
    heating: { status: low(state.thermal.indoorC, THRESHOLDS.indoorC), detail: `Indoor ${state.thermal.indoorC} °C` },
    communications: { status: commsStatus, detail: `Link quality ${state.comms.linkQuality}` },
    medical: { status: medStatus, detail: med.length ? med.map((a) => `${a.id} ${a.status}`).join(', ') : 'No medical assets reported (status unknown)' },
    fuel: { status: low(aut, THRESHOLDS.fuelH), detail: `Autonomy ${round(aut, 0)} h at current demand` },
    infrastructure: { status: offlineOther.length ? 'warning' : degradedOther.length ? 'warning' : 'ok', detail: `${offlineOther.length} offline, ${degradedOther.length} degraded` },
  };

  const priorities = EMERGENCY_ORDER.map((category, i) => ({
    rank: i + 1, category, label: LABELS[category], ...status[category],
    alerts: alerts.filter((a) => (EMERGENCY_ORDER.includes(a.category) ? a.category : 'infrastructure') === category),
  }));

  // Critical alerts + critically-degraded categories are ALWAYS pinned, regardless of category/filter.
  const pinnedCritical = [
    ...alerts.filter((a) => a.severity === 'critical').map((a) => ({ kind: 'alert', ...a })),
    ...priorities.filter((p) => p.status === 'critical').map((p) => ({ kind: 'status', category: p.category, message: `${p.label}: ${p.detail}` })),
  ].sort((a, b) => rank(a.category) - rank(b.category));

  return { mode: 'emergency', stationId: state.stationId, asOf: state.asOf, priorities, pinnedCritical };
}

/** UI filter helper: operators may filter the feed, but critical items can never be filtered out. */
export function filterEmergencyAlerts(view, predicate) {
  const critical = view.pinnedCritical;
  const rest = view.priorities.flatMap((p) => p.alerts).filter((a) => a.severity !== 'critical' && predicate(a));
  return [...critical, ...rest];
}

// ---------------- Station comparison ----------------
const ROWS = [
  ['condition', 'onlineAssetPct', 'Assets online', '%', true], ['condition', 'degradedAssets', 'Degraded assets', '', false],
  ['energy', 'capacityMarginKw', 'Generation margin', 'kW', true], ['energy', 'batteryPct', 'Battery level', '%', true],
  ['fuel', 'autonomyH', 'Fuel autonomy', 'h', true], ['fuel', 'tankL', 'Fuel on hand', 'L', true],
  ['logistics', 'nextResupplyH', 'Next resupply in', 'h', false],
  ['infrastructure', 'offlineAssets', 'Offline assets', '', false],
  ['risk', 'riskScore', 'Baseline risk score', '', false],
  ['environment', 'outdoorC', 'Outdoor temperature', '°C', null], ['environment', 'windMs', 'Wind', 'm/s', false],
];

export function stationFacts(state, riskScore) {
  const a = state.assets || [];
  return {
    onlineAssetPct: a.length ? round((a.filter((x) => x.status === 'online').length / a.length) * 100, 0) : null,
    degradedAssets: a.filter((x) => x.status === 'degraded').length,
    capacityMarginKw: round(onlineCapacityKw(state) - state.energy.baseDemandKw, 0),
    batteryPct: round(batteryPct(state), 0),
    autonomyH: round(fuelAutonomyH(state), 0), tankL: state.fuel.tankL,
    nextResupplyH: state.logistics.nextResupplyH,
    offlineAssets: a.filter((x) => x.status === 'offline').length,
    riskScore: riskScore ?? baselineMetrics(state).riskScore,
    outdoorC: state.environment.outdoorC, windMs: state.environment.windMs,
  };
}

export function compareStations(stateA, stateB, { riskA, riskB } = {}) {
  const missing = [!stateA && 'A', !stateB && 'B'].filter(Boolean);
  if (missing.length) return { ok: false, code: 'STATION_DATA_MISSING', missing, rows: [] };
  const fa = stationFacts(stateA, riskA), fb = stationFacts(stateB, riskB);
  const rows = ROWS.map(([dimension, key, label, unit, higherBetter]) => {
    const a = fa[key], b = fb[key];
    const better = higherBetter === null || a === b || a === null || b === null ? 'n/a' : ((b > a) === higherBetter ? 'b' : 'a');
    return { dimension, metric: key, label, unit, a, b, diff: a === null || b === null ? null : round(b - a), better: a === b ? 'tie' : better };
  });
  return { ok: true, stations: { a: stateA.stationId, b: stateB.stationId }, asOf: { a: stateA.asOf, b: stateB.asOf }, rows };
}
