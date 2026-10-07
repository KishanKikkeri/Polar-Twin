// Agent 4C — baseline vs scenario comparison:
// absolute difference -> percentage difference -> affected systems -> risk impact -> recommendation.

import { round } from './core.js';

// worse: 'higher' => an increase is bad; 'lower' => a decrease is bad.
export const METRIC_META = Object.freeze({
  shortfallHours: { label: 'Hours with unmet load', unit: 'h', worse: 'higher', system: 'power' },
  peakUnmetKw: { label: 'Peak unmet load', unit: 'kW', worse: 'higher', system: 'power' },
  totalUnmetKwh: { label: 'Total unmet energy', unit: 'kWh', worse: 'higher', system: 'power' },
  batteryMinPct: { label: 'Minimum battery level', unit: '%', worse: 'lower', system: 'energy storage' },
  fuelEndL: { label: 'Fuel remaining at end', unit: 'L', worse: 'lower', system: 'fuel' },
  fuelAutonomyH: { label: 'Fuel autonomy at end', unit: 'h', worse: 'lower', system: 'fuel' },
  minIndoorC: { label: 'Minimum indoor temperature', unit: '°C', worse: 'lower', system: 'heating' },
  minCommsQuality: { label: 'Minimum comms link quality', unit: '', worse: 'lower', system: 'communications' },
  riskScore: { label: 'Risk score', unit: '', worse: 'higher', system: 'overall risk' },
});

export function pctDiff(base, scen) {
  if (base === 0) return scen === 0 ? 0 : null; // undefined relative to zero; UI shows "n/a"
  return round(((scen - base) / Math.abs(base)) * 100);
}

export function buildComparison({ baseline, result, scenario, state }) {
  const rows = [];
  const affected = new Map();
  for (const [key, meta] of Object.entries(METRIC_META)) {
    const b = baseline.metrics[key], s = result.metrics[key];
    const abs = round(s - b);
    const direction = abs === 0 ? 'unchanged' : (abs > 0) === (meta.worse === 'higher') ? 'worse' : 'better';
    rows.push({ metric: key, label: meta.label, unit: meta.unit, baseline: b, scenario: s, absDiff: abs, pctDiff: pctDiff(b, s), direction });
    if (abs !== 0 && key !== 'riskScore') {
      const cur = affected.get(meta.system);
      affected.set(meta.system, { system: meta.system, direction: cur?.direction === 'worse' ? 'worse' : direction, metrics: [...(cur?.metrics || []), key] });
    }
  }
  if (scenario.type === 'resupply_delay' && !affected.has('logistics')) {
    affected.set('logistics', { system: 'logistics', direction: 'worse', metrics: [] });
  }
  const bScore = baseline.metrics.riskScore, sScore = result.metrics.riskScore;
  const riskImpact = {
    baseline: { score: bScore, level: baseline.metrics.riskLevel },
    scenario: { score: sScore, level: result.metrics.riskLevel },
    delta: sScore - bScore,
    levelChanged: baseline.metrics.riskLevel !== result.metrics.riskLevel,
  };
  return {
    rows,
    affectedSystems: [...affected.values()],
    riskImpact,
    recommendations: recommend({ result, scenario, state, riskImpact }),
  };
}

export function recommend({ result, scenario, state, riskImpact }) {
  const m = result.metrics;
  const recs = [];
  const add = (action, reason, metricRef) => recs.push({ priority: recs.length + 1, action, reason, metricRef });

  if (scenario.type === 'generator_failure') {
    const standby = (state.assets || []).find((a) => a.type === 'generator' && a.status === 'offline' && a.id !== scenario.params.assetId);
    if (standby) add(`Start standby generator ${standby.id}`, `${scenario.params.assetId} loss leaves a generation gap`, 'totalUnmetKwh');
  }
  if (m.shortfallHours > 0) {
    const when = m.batteryDepletionHour !== null ? ` Battery is depleted by hour ${m.batteryDepletionHour}.` : '';
    add('Shed non-essential loads', `Unmet load for ${m.shortfallHours} h.${when}`, 'shortfallHours');
  }
  if (m.minIndoorC < 10) add('Prioritise heating; consolidate occupants into heated modules', `Indoor temperature falls to ${m.minIndoorC} °C`, 'minIndoorC');
  if (m.fuelAutonomyH < 48) add('Conserve fuel and request expedited resupply', `Fuel autonomy ${m.fuelAutonomyH} h at end of horizon`, 'fuelAutonomyH');
  if (m.minCommsQuality < 0.5) add('Switch to backup comms link; send critical traffic first', `Link quality drops to ${m.minCommsQuality}`, 'minCommsQuality');
  if (!recs.length) add('No intervention required; continue monitoring', `Risk level ${riskImpact.scenario.level}`, 'riskScore');
  return recs;
}
