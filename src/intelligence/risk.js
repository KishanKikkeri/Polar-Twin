// Agent 4B — predictive risk engine. Risk is built ONLY from evidence factors; each factor carries its provenance.
// Observed/current-state evidence has confidence 1; PREDICTED evidence is weighted by its model confidence.
// Domain score = 100 * (1 - Π(1 - effective_i)) (noisy-OR): adding evidence can never lower a score, and the score is
// exactly reproducible from the returned factors. A domain with NO evidence is "unknown", never "low".
import { MODELS, PROVENANCE, clamp, round } from './common.js';

export const DOMAINS = ['energy', 'infrastructure', 'logistics', 'environment', 'equipment'];
export const severityOf = (s) => (s === null ? 'unknown' : s < 25 ? 'low' : s < 50 ? 'moderate' : s < 75 ? 'high' : 'critical');
export const DEGRADED_FACTOR = 0.6; // generator at reduced output when status = degraded (assumption)
export const onlineCapacityKw = (state) => (state.assets || []).filter((a) => a.type === 'generator' && a.status !== 'offline').reduce((s, a) => s + a.capacityKw * (a.status === 'degraded' ? DEGRADED_FACTOR : 1), 0);

const factor = (domain, id, label, risk, evidence, provenance, confidence = 1, source = null) => {
  const r = round(clamp(risk, 0, 1), 3), c = round(clamp(confidence, 0, 1), 3);
  return { domain, id, label, risk: r, confidence: c, effective: round(r * c, 4), evidence, provenance, source };
};
export const domainScore = (factors) => (factors.length ? Math.round(100 * (1 - factors.reduce((p, f) => p * (1 - f.effective), 1))) : null);
const LOGI = { critical: 1, high: 0.7, moderate: 0.4, low: 0.05 };

export function computeRisk({ state, demandForecast = null, anomalies = [], maintenance = [], logistics = null, previous = null, asOf = null }) {
  const F = [], cur = PROVENANCE.DERIVED, inP = state?.provenance ?? null;
  if (state) {
    const cap = onlineCapacityKw(state), demand = state.energy?.baseDemandKw;
    if (demand !== undefined) F.push(factor('energy', 'capacity_margin', 'Demand vs online generation', cap <= 0 ? 1 : clamp((demand / cap - 0.7) / 0.3, 0, 1), { demandKw: demand, onlineCapacityKw: round(cap, 1), inputProvenance: inP }, cur, 1, 'twin.state'));
    if (state.energy?.batteryCapacityKwh > 0) { const pct = (state.energy.batteryKwh / state.energy.batteryCapacityKwh) * 100; F.push(factor('energy', 'battery_low', 'Battery reserve', (50 - pct) / 50, { batteryPct: round(pct, 1), inputProvenance: inP }, cur, 1, 'twin.state')); }
    const rest = (state.assets || []).filter((a) => !['generator'].includes(a.type));
    if (rest.length) { const off = rest.filter((a) => a.status === 'offline').length, deg = rest.filter((a) => a.status === 'degraded').length; F.push(factor('infrastructure', 'asset_outage', 'Offline / degraded infrastructure', ((off + 0.5 * deg) / rest.length) * 2, { offline: off, degraded: deg, total: rest.length, inputProvenance: inP }, cur, 1, 'twin.state')); }
    if (Array.isArray(state.alerts)) { const crit = state.alerts.filter((a) => a.severity === 'critical').length; F.push(factor('infrastructure', 'critical_alerts', 'Active critical alerts', 0.5 * crit, { criticalAlerts: crit, inputProvenance: inP }, cur, 1, 'twin.state')); }
    if (state.environment?.windMs !== undefined) F.push(factor('environment', 'wind', 'Wind speed', (state.environment.windMs - 15) / 25, { windMs: state.environment.windMs, inputProvenance: inP }, cur, 1, 'twin.state'));
    if (state.environment?.outdoorC !== undefined) F.push(factor('environment', 'cold', 'Outdoor temperature', (-20 - state.environment.outdoorC) / 25, { outdoorC: state.environment.outdoorC, inputProvenance: inP }, cur, 1, 'twin.state'));
  }
  if (demandForecast && state) {
    const cap = onlineCapacityKw(state), peak = Math.max(...demandForecast.points.map((p) => p.upper));
    F.push(factor('energy', 'forecast_peak', `Forecast peak demand (${demandForecast.horizonH} h, upper bound)`, cap <= 0 ? 1 : (peak / cap - 0.8) / 0.4, { peakUpperKw: round(peak, 1), onlineCapacityKw: round(cap, 1), model: demandForecast.model }, PROVENANCE.PREDICTED, demandForecast.confidence, 'forecast'));
  }
  if (logistics?.resupplyRisk && LOGI[logistics.resupplyRisk.level] !== undefined) F.push(factor('logistics', 'resupply_risk', 'Fuel vs resupply timing', LOGI[logistics.resupplyRisk.level], { level: logistics.resupplyRisk.level, daysOfAutonomy: logistics.daysOfAutonomy, marginHours: logistics.resupplyRisk.marginHours }, PROVENANCE.PREDICTED, logistics.confidence, 'logistics'));
  const worst = new Map();
  for (const a of anomalies.filter((x) => x.kind === 'equipment')) { const k = `${a.assetId}|${a.channel}`, w = worst.get(k); if (!w || (a.severity === 'critical' && w.severity !== 'critical')) worst.set(k, a); }
  for (const a of worst.values()) F.push(factor('equipment', `anomaly:${a.assetId}:${a.channel}`, `Anomaly on ${a.assetId} ${a.channel}`, a.severity === 'critical' ? 0.8 : 0.4, { observed: a.observed, expected: a.expected, ts: a.ts, severity: a.severity }, PROVENANCE.DERIVED, a.confidence, 'anomaly'));
  for (const m of maintenance.filter((x) => x.status === 'ok')) F.push(factor('equipment', `maintenance:${m.assetId}`, `Failure risk index ${m.assetId}`, m.failureRisk30d, { failureRisk30d: m.failureRisk30d, healthIndex: m.healthIndex, urgency: m.urgency }, PROVENANCE.PREDICTED, m.confidence, 'maintenance'));

  const domains = {};
  for (const d of DOMAINS) { const fs = F.filter((f) => f.domain === d); const s = domainScore(fs); domains[d] = { score: s, severity: severityOf(s), level: severityOf(s), factors: fs }; }
  const known = DOMAINS.map((d) => domains[d].score).filter((s) => s !== null);
  const score = known.length ? Math.round(0.6 * Math.max(...known) + 0.4 * (known.reduce((a, b) => a + b, 0) / known.length)) : null;
  const flat = [...F].sort((a, b) => b.effective - a.effective);
  const confs = F.map((f) => f.confidence);
  return {
    kind: 'risk', asOf, score, severity: severityOf(score), level: severityOf(score),
    trend: previous?.score !== undefined && previous.score !== null && score !== null ? (score - previous.score >= 5 ? 'rising' : score - previous.score <= -5 ? 'falling' : 'stable') : 'unknown',
    confidence: confs.length ? round((confs.reduce((a, b) => a + b, 0) / confs.length) * (0.5 + 0.5 * (known.length / DOMAINS.length)), 3) : 0,
    domainsWithEvidence: known.length, domains, factors: flat, drivers: flat.slice(0, 3).filter((f) => f.effective > 0).map((f) => f.label),
    model: MODELS.risk, provenance: PROVENANCE.DERIVED, inputProvenance: inP,
    note: 'Current observed/synthetic state is read, never overwritten; predicted evidence enters only as separately-labelled PREDICTED factors.',
  };
}
