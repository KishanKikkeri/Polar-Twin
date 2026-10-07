// Agent 4B — resource optimisation. Rule-based recommendations; each carries `why` (evidence-backed claims).
// Quantities are arithmetic on supplied evidence only; where a figure cannot be derived, none is given.
import { HOUR, IntelligenceError, MODELS, PROVENANCE, round } from './common.js';
import { onlineCapacityKw } from './risk.js';

const hhmm = (ts) => `${ts.slice(11, 16)}Z`;

export function recommend({ state, demandForecast = null, logistics = null, risk = null, maintenance = [], asOf = null }) {
  const out = [];
  const add = (type, priority, action, why, quantified, confidence, provenance = PROVENANCE.DERIVED) => {
    if (!why?.length || why.some((w) => !w.claim || !w.evidence?.length)) throw new IntelligenceError('UNEXPLAINED_RECOMMENDATION', `Recommendation ${type} lacks evidence`);
    out.push({ id: `${type}:${out.length + 1}`, type, priority, action, why, quantified, confidence: round(confidence, 3), provenance, model: MODELS.optimizer, asOf });
  };
  const cap = state ? onlineCapacityKw(state) : null;
  const demand = state?.energy?.baseDemandKw;

  if (cap !== null && demand !== undefined && demand > cap) {
    const need = round(demand - cap, 0);
    add('load_reduction', 1, `Shed about ${need} kW of non-essential load immediately`, [{ claim: 'Current demand exceeds online generation', evidence: [{ ref: 'twin.state', name: 'demandKw', value: demand, unit: 'kW', provenance: PROVENANCE.DERIVED }, { ref: 'twin.state', name: 'onlineCapacityKw', value: round(cap, 0), unit: 'kW', provenance: PROVENANCE.DERIVED }] }], { reduceKw: need }, 1);
  }
  if (demandForecast && cap) {
    const pk = demandForecast.points.reduce((a, p) => (p.upper > a.upper ? p : a)), tr = demandForecast.points.reduce((a, p) => (p.value < a.value ? p : a)), ceil = 0.9 * cap;
    if (pk.upper > ceil) {
      const need = round(pk.upper - ceil, 0);
      add('load_reduction', 2, `Plan to cut peak load by about ${need} kW around ${hhmm(pk.ts)} (defer non-essential loads)`, [{ claim: `Forecast upper-bound demand exceeds 90% of online generation within ${demandForecast.horizonH} h`, evidence: [{ ref: 'forecast', name: 'peakUpperKw', value: pk.upper, unit: 'kW', provenance: PROVENANCE.PREDICTED }, { ref: 'twin.state', name: 'ceilingKw (90% of online)', value: round(ceil, 0), unit: 'kW', provenance: PROVENANCE.DERIVED }] }], { reduceKw: need, atTs: pk.ts }, demandForecast.confidence, PROVENANCE.PREDICTED);
    }
    if (pk.value / Math.max(tr.value, 1e-6) >= 1.25) {
      add('energy_redistribution', 4, `Shift deferrable loads from ${hhmm(pk.ts)} toward ${hhmm(tr.ts)}`, [{ claim: 'Forecast demand has a pronounced daily swing, so timing of deferrable loads matters', evidence: [{ ref: 'forecast', name: 'peakKw', value: pk.value, unit: 'kW', provenance: PROVENANCE.PREDICTED, ts: pk.ts }, { ref: 'forecast', name: 'troughKw', value: tr.value, unit: 'kW', provenance: PROVENANCE.PREDICTED, ts: tr.ts }] }], null, demandForecast.confidence, PROVENANCE.PREDICTED);
    }
    const b = demandForecast.drivers?.temperatureKwPerDegC;
    if (b !== null && b !== undefined && b < 0 && risk?.domains?.energy?.score >= 25) {
      add('heating_adjustment', 5, 'Stage heating start-ups and review setpoints ahead of cold spells', [{ claim: 'Model shows demand rises as outdoor temperature falls, and energy risk is already elevated', evidence: [{ ref: 'forecast.drivers', name: 'temperatureKwPerDegC', value: b, unit: 'kW/°C', provenance: PROVENANCE.PREDICTED }, { ref: 'risk.energy', name: 'score', value: risk.domains.energy.score, provenance: PROVENANCE.DERIVED }] }], { demandRisePerDegCKw: round(Math.abs(b), 2) }, demandForecast.confidence, PROVENANCE.PREDICTED);
    }
  }
  if (logistics?.status === 'ok' && logistics.resupplyRisk) {
    const rr = logistics.resupplyRisk, lvl = rr.level;
    if (rr.etaTs && ['moderate', 'high', 'critical'].includes(lvl)) {
      const etaH = (Date.parse(rr.etaTs) - Date.parse(logistics.asOf)) / HOUR, reqBurn = logistics.levelL / (etaH + rr.safetyMarginH), pct = Math.max(0, (1 - reqBurn / logistics.burnLph) * 100);
      if (pct > 0) add('fuel_conservation', lvl === 'critical' ? 1 : 3, `Reduce fuel burn by about ${round(pct, 0)}% until resupply arrives`, [{ claim: 'At the current burn rate fuel does not cover the time to resupply plus the safety margin', evidence: [{ ref: 'logistics', name: 'levelL', value: logistics.levelL, unit: 'L', provenance: PROVENANCE.DERIVED }, { ref: 'logistics', name: 'burnLph', value: logistics.burnLph, unit: 'L/h', provenance: PROVENANCE.PREDICTED }, { ref: 'logistics', name: 'hoursToResupply', value: round(etaH, 0), unit: 'h', provenance: PROVENANCE.DERIVED }] }], { burnReductionPct: round(pct, 1), targetBurnLph: round(reqBurn, 2) }, logistics.confidence, PROVENANCE.PREDICTED);
    }
    if (['high', 'critical'].includes(lvl)) add('resupply_timing', lvl === 'critical' ? 1 : 2, `Request expedited resupply to arrive before ${logistics.depletion.earliestTs.slice(0, 16)}Z (earliest depletion) minus the safety margin`, [{ claim: rr.reason, evidence: [{ ref: 'logistics', name: 'earliestDepletionTs', value: logistics.depletion.earliestTs, provenance: PROVENANCE.PREDICTED }, { ref: 'logistics', name: 'etaTs', value: rr.etaTs, provenance: PROVENANCE.DERIVED }] }], { earliestMarginHours: rr.earliestMarginHours }, logistics.confidence, PROVENANCE.PREDICTED);
    else if (lvl === 'low') add('resupply_timing', 9, 'Resupply timing is adequate; no expedite needed', [{ claim: rr.reason, evidence: [{ ref: 'logistics', name: 'earliestMarginHours', value: rr.earliestMarginHours, unit: 'h', provenance: PROVENANCE.PREDICTED }] }], null, logistics.confidence, PROVENANCE.PREDICTED);
  }
  for (const m of maintenance.filter((x) => x.status === 'ok' && x.urgency !== 'routine')) {
    add('maintenance_inspection', m.urgency === 'urgent' ? 2 : 6, `${m.recommendedInspection} on ${m.assetId} within ${m.dueInDays} days`, [{ claim: m.reason, evidence: [{ ref: 'maintenance', name: 'healthIndex', value: m.healthIndex, provenance: PROVENANCE.PREDICTED }, { ref: 'maintenance', name: 'failureRisk30d', value: m.failureRisk30d, provenance: PROVENANCE.PREDICTED }] }], { dueInDays: m.dueInDays }, m.confidence, PROVENANCE.PREDICTED);
  }
  return out.sort((a, b) => a.priority - b.priority);
}
