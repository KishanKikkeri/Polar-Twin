// Agent 4B — predictive maintenance from degradation indicators.
// Uses ONLY indicators actually supplied. Missing sensors are reported as missing, never estimated.
// Failure "risk" is a bounded heuristic index (not a calibrated probability) and is labelled as such.
import { HOUR, MODELS, PROVENANCE, clamp, iso, mean, resampleHourly, round } from './common.js';

// Nominal/critical levels are ASSUMED placeholders: calibrate against manufacturer limits / station history before operational use.
export const INDICATOR_SPECS = Object.freeze({
  loading:             { assetTypes: ['generator'], nominal: 0.6, critical: 1.0, weight: 1, inspect: 'Review generator loading profile and load sharing across units' },
  exhaustTempC:        { assetTypes: ['generator'], nominal: 380, critical: 520, weight: 1.2, inspect: 'Inspect cooling system, turbocharger and exhaust path' },
  specificFuelLPerKwh: { assetTypes: ['generator'], nominal: 0.28, critical: 0.36, weight: 1, inspect: 'Inspect injectors, air filters and fuel quality (fuel efficiency is degrading)' },
  commsPacketLoss:     { assetTypes: ['comms'], nominal: 0.01, critical: 0.2, weight: 1, inspect: 'Inspect antenna alignment, cabling and link hardware' },
  commsLatencyMs:      { assetTypes: ['comms'], nominal: 600, critical: 1500, weight: 0.8, inspect: 'Inspect satellite terminal and modem' },
});
const dailyMeans = (pts) => { const r = resampleHourly(pts), days = new Map(); r.values.forEach((v, i) => { if (v === null) return; const d = Math.floor((r.start / HOUR + i) / 24); (days.get(d) || days.set(d, []).get(d)).push(v); }); return [...days.entries()].sort((a, b) => a[0] - b[0]).filter(([, a]) => a.length >= 12).map(([d, a]) => [d, mean(a)]); };
function ols(xs, ys) { const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0; xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }); const slope = sxx ? sxy / sxx : 0; return { slope, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 }; }

/** asset = { assetId, assetType, indicators: { name: [{ts,value}] }, provenance? } */
export function predictMaintenance(asset, { asOf } = {}) {
  const used = [], missing = [], notes = [];
  const wanted = Object.entries(INDICATOR_SPECS).filter(([, s]) => s.assetTypes.includes(asset.assetType)).map(([k]) => k);
  for (const k of wanted) {
    const days = dailyMeans(asset.indicators?.[k] || []);
    if (days.length < 5) { missing.push({ indicator: k, reason: days.length ? 'insufficient_history' : 'no_data' }); continue; }
    const w = days.slice(-14), spec = INDICATOR_SPECS[k];
    const norm = w.map(([, v]) => (v - spec.nominal) / (spec.critical - spec.nominal));
    const level = clamp(mean(norm.slice(-2)), 0, 1.5);
    const f = ols(w.map(([d]) => d), norm);
    used.push({ indicator: k, level: round(level, 3), slopePerDay: round(f.slope, 4), r2: round(f.r2, 3), days: w.length, weight: spec.weight, inspect: spec.inspect, daysToCritical: f.slope > 1e-4 && level < 1 ? round((1 - level) / f.slope, 1) : null });
  }
  const base = { kind: 'maintenance', assetId: asset.assetId, assetType: asset.assetType, asOf: asOf ?? null, model: MODELS.maintenance, provenance: PROVENANCE.PREDICTED, inputProvenance: asset.provenance ?? null, usedIndicators: used.map((u) => u.indicator), missingIndicators: missing };
  if (!used.length) return { ...base, status: 'insufficient_data', healthIndex: null, failureRisk30d: null, urgency: 'unknown', confidence: 0, reason: `No usable degradation indicators for ${asset.assetType} ${asset.assetId}; no health estimate is made.` };

  const wsum = used.reduce((s, u) => s + u.weight, 0);
  const stress = (d) => { const per = used.map((u) => clamp(u.level + Math.max(u.slopePerDay, 0) * d, 0, 1.5)); return clamp(0.7 * Math.max(...per) + 0.3 * (used.reduce((s, u, i) => s + u.weight * per[i], 0) / wsum), 0, 1); };
  const s0 = stress(0), s7 = stress(7), s30 = stress(30);
  const failureRisk30d = round(0.9 * s30 ** 2, 3);
  const dtc = used.map((u) => u.daysToCritical).filter((x) => x !== null), minDtc = dtc.length ? Math.min(...dtc) : null;
  const urgency = failureRisk30d >= 0.5 || (minDtc !== null && minDtc < 14) ? 'urgent' : failureRisk30d >= 0.2 || (minDtc !== null && minDtc < 45) ? 'soon' : 'routine';
  const top = [...used].sort((a, b) => (b.level + Math.max(b.slopePerDay, 0) * 30) - (a.level + Math.max(a.slopePerDay, 0) * 30))[0];
  const confidence = round(clamp(Math.min(...used.map((u) => u.days)) / 14, 0, 1) * clamp(mean(used.map((u) => u.r2)) + 0.3, 0.3, 1), 3);
  if (missing.length) notes.push(`Indicators not available: ${missing.map((m) => m.indicator).join(', ')}`);
  return { ...base, status: 'ok', healthIndex: round(100 * (1 - s0), 1), healthTrajectory: [{ offsetDays: 0, healthIndex: round(100 * (1 - s0), 1) }, { offsetDays: 7, healthIndex: round(100 * (1 - s7), 1) }, { offsetDays: 30, healthIndex: round(100 * (1 - s30), 1) }],
    failureRisk30d, riskNote: 'heuristic index in [0,0.9], not a calibrated failure probability', urgency, daysToCritical: minDtc,
    dueInDays: urgency === 'urgent' ? Math.max(1, Math.min(7, Math.floor((minDtc ?? 14) / 2))) : urgency === 'soon' ? 21 : 90,
    recommendedInspection: top.inspect, indicators: used, confidence,
    reason: `${top.indicator} is at ${round(top.level * 100, 0)}% of its nominal-to-critical range${top.slopePerDay > 1e-4 ? ` and rising ${round(top.slopePerDay * 100, 1)}%/day` : ''}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}` };
}
