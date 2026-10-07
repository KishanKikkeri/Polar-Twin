// Agent 4B — anomaly detection. Robust residual z-score against an expected value:
//   seasonal channels : median of the same hour on prior days (>= 3 lags of up to 7)
//   other channels    : rolling median of previous 24 samples (>= 6)
// Scale = 1.4826 * MAD of residuals (floored by a per-channel minimum). Hard physical limits override the z-score.
import { HOUR, MODELS, PROVENANCE, classificationMetrics, clamp, iso, mad, median, resampleHourly, round } from './common.js';

export const THRESHOLDS = Object.freeze({ warn: 3.5, critical: 6 }); // assumed defaults, not calibrated on real station data
export const CHANNELS = Object.freeze({
  loading:     { kind: 'equipment', unit: 'frac', seasonal: true, minScale: 0.02, hardHigh: 1.0 },
  exhaustTempC:{ kind: 'equipment', unit: '°C', seasonal: true, minScale: 3, hardHigh: 550 },
  demandKw:    { kind: 'equipment', unit: 'kW', seasonal: true, minScale: 3 },
  burnLph:     { kind: 'equipment', unit: 'L/h', seasonal: true, minScale: 1 },
  commsLatencyMs: { kind: 'equipment', unit: 'ms', seasonal: false, minScale: 20 },
  commsPacketLoss:{ kind: 'equipment', unit: 'frac', seasonal: false, minScale: 0.01, hardHigh: 0.3 },
  outdoorC:    { kind: 'environment', unit: '°C', seasonal: true, minScale: 1 },
  windMs:      { kind: 'environment', unit: 'm/s', seasonal: false, minScale: 1, hardHigh: 40 },
  pressureHpa: { kind: 'environment', unit: 'hPa', seasonal: false, minScale: 1.5 },
});
const MIN_POINTS = 72;

function expectedSeries(vals, seasonal) {
  return vals.map((v, i) => {
    const ref = [];
    if (seasonal) for (let k = 1; k <= 7; k++) { const x = vals[i - 24 * k]; if (x !== undefined && x !== null) ref.push(x); }
    else for (let k = 1; k <= 24; k++) { const x = vals[i - k]; if (x !== undefined && x !== null) ref.push(x); }
    return ref.length >= (seasonal ? 3 : 6) ? median(ref) : null;
  });
}

/** series = { assetId, channel, points:[{ts,value}], provenance? } */
export function detectAnomalies(series, { thresholds = THRESHOLDS } = {}) {
  const spec = CHANNELS[series.channel];
  const base = { assetId: series.assetId ?? null, channel: series.channel };
  if (!spec) return { ...base, status: 'skipped', reason: 'unknown_channel', anomalies: [] };
  const r = resampleHourly(series.points);
  if (r.values.filter((v) => v !== null).length < MIN_POINTS) return { ...base, status: 'skipped', reason: 'insufficient_data', anomalies: [] };
  const exp = expectedSeries(r.values, spec.seasonal);
  const res = r.values.map((v, i) => (v === null || exp[i] === null ? null : v - exp[i]));
  const rv = res.filter((x) => x !== null);
  const scale = Math.max(1.4826 * mad(rv), spec.minScale);
  const out = [];
  r.values.forEach((v, i) => {
    if (v === null || exp[i] === null || r.imputed[i]) return; // never flag interpolated values
    const z = res[i] / scale, hard = spec.hardHigh !== undefined && v > spec.hardHigh;
    if (Math.abs(z) < thresholds.warn && !hard) return;
    const severity = hard || Math.abs(z) >= thresholds.critical ? 'critical' : 'warning';
    const confidence = round(clamp(1 - Math.exp(-Math.abs(z) / 3), 0.5, 0.99), 3);
    out.push({
      assetId: series.assetId ?? null, channel: series.channel, metric: series.channel, kind: spec.kind, ts: iso(r.start + i * HOUR), severity,
      observed: round(v, 4), expected: round(exp[i], 4), expectedRange: { low: round(exp[i] - thresholds.warn * scale, 4), high: round(exp[i] + thresholds.warn * scale, 4) },
      zScore: round(z, 2), confidence, score: confidence, unit: spec.unit, model: MODELS.anomaly, provenance: PROVENANCE.DERIVED, inputProvenance: series.provenance ?? null,
      reason: hard ? `Observed ${round(v, 3)} ${spec.unit} exceeds hard limit ${spec.hardHigh}` : `Observed ${round(v, 3)} ${spec.unit} is ${round(Math.abs(z), 1)} robust σ ${z > 0 ? 'above' : 'below'} expected ${round(exp[i], 3)} (${spec.seasonal ? 'same-hour median of prior days' : 'rolling 24 h median'})`,
    });
  });
  return { ...base, status: 'ok', scale: round(scale, 4), evaluated: rv.length, anomalies: out };
}

/** Point-level evaluation against injected labels (indices on the hourly grid). `tolerance` lets a detection within ±n hours count. */
export function evaluateAnomalyDetector(series, labelIdx, { tolerance = 0, from = 72 } = {}) {
  const r = resampleHourly(series.points), det = detectAnomalies(series);
  const flagged = new Set(det.anomalies.map((a) => Math.round((Date.parse(a.ts) - r.start) / HOUR)));
  const labels = new Set(labelIdx);
  const near = (set, i) => { for (let k = -tolerance; k <= tolerance; k++) if (set.has(i + k)) return true; return false; };
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = from; i < r.values.length; i++) {
    if (labels.has(i)) { if (near(flagged, i)) tp++; else fn++; }
    else if (flagged.has(i)) { if (!near(labels, i)) fp++; } // a flag next to a labelled point is not penalised
    else if (!near(labels, i)) tn++;
  }
  return classificationMetrics({ tp, fp, fn, tn });
}
