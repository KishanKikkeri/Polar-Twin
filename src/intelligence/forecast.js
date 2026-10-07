// Agent 4B — energy demand forecasting (24 h / 7 d).
// Baseline : seasonal naive (24 h lag; 168 h lag for horizons > 24 h when history allows).
// Improved : ridge regression on time-of-day harmonics, outdoor temperature, activity, and lag-24 demand,
//            forecast recursively. Uncertainty = Gaussian interval from in-sample residual sigma (heuristic, see docs).
import { HOUR, IntelligenceError, MODELS, PROVENANCE, clamp, iso, mean, regressionMetrics, resampleHourly, ridgeFit, round, std } from './common.js';

const Z80 = 1.2816;
const MAX_HORIZON = 168;

function alignTo(base, pts) {
  if (!pts || !pts.length) return null;
  const r = resampleHourly(pts);
  if (r.start === null) return null;
  const off = Math.round((r.start - base.start) / HOUR);
  return { ...r, at: (i) => { const j = i - off; return j >= 0 && j < r.values.length ? r.values[j] : null; } };
}
const valid = (a) => a.filter((v) => v !== null);
function climatology(vals, startHour, periods = [168, 24]) {
  const bucket = (period) => { const m = new Map(); vals.forEach((v, i) => { if (v === null) return; const k = (startHour + i) % period; (m.get(k) || m.set(k, []).get(k)).push(v); }); return m; };
  const wk = periods.includes(168) ? bucket(168) : null, dy = bucket(24);
  return (idx) => { const a = wk?.get((startHour + idx) % 168); if (a && a.length >= 2) return mean(a); const b = dy.get((startHour + idx) % 24); return b ? mean(b) : null; };
}

function prepare(history, horizonH, asOf) {
  if (!Number.isInteger(horizonH) || horizonH < 1 || horizonH > MAX_HORIZON) throw new IntelligenceError('INVALID_HORIZON', `horizonH must be an integer in [1, ${MAX_HORIZON}]`);
  const d = resampleHourly(history?.demandKw);
  const need = horizonH <= 24 ? 72 : 336;
  const have = valid(d.values).length;
  if (have < need) throw new IntelligenceError('INSUFFICIENT_DATA', `Need >= ${need} hourly demand points, have ${have}`, { have, need });
  if (d.rawMissingFraction > 0.3) throw new IntelligenceError('INSUFFICIENT_DATA', 'More than 30% of the demand window is missing (interpolation does not count as observed)', { rawMissingFraction: d.rawMissingFraction });
  const n = d.values.length, lastMs = d.start + (n - 1) * HOUR;
  if (asOf && Date.parse(asOf) - lastMs > 3 * HOUR) throw new IntelligenceError('INSUFFICIENT_DATA', 'Demand history is stale relative to asOf', { lastTs: iso(lastMs), asOf });
  return { d, n, lastMs, startHour: Math.floor(d.start / HOUR), have };
}

function baseline(p, H) {
  const { d, n } = p, ext = d.values.slice();
  const lag = H > 24 && n >= 168 ? 168 : 24;
  const hod = climatology(d.values, p.startHour);
  const diffs = []; for (let i = lag; i < n; i++) if (d.values[i] !== null && d.values[i - lag] !== null) diffs.push(d.values[i] - d.values[i - lag]);
  const sigma = Math.max(std(diffs), 1e-6);
  for (let k = 0; k < H; k++) { const idx = ext.length; ext.push(ext[idx - lag] ?? ext[idx - 24] ?? hod(idx)); }
  return { values: ext.slice(n), sigma, drivers: null, assumptions: [], trainRows: diffs.length, lag };
}

function ridge(p, history, H, { futureTemp, futureActivity }) {
  const { d, n } = p, assumptions = [];
  const temp = alignTo(d, history.outdoorC), act = alignTo(d, history.activity);
  const useT = !!temp && valid(Array.from({ length: n }, (_, i) => temp.at(i))).length >= 0.7 * n;
  const useA = !!act && valid(Array.from({ length: n }, (_, i) => act.at(i))).length >= 0.7 * n;
  const feat = (hr, t, a, lag) => { const w = (2 * Math.PI * hr) / 24; const f = [1, Math.sin(w), Math.cos(w), Math.sin(2 * w), Math.cos(2 * w)]; if (useT) f.push(t); if (useA) f.push(a); f.push(lag); return f; };
  const X = [], y = [];
  for (let i = Math.max(24, n - 672); i < n; i++) {
    const t = useT ? temp.at(i) : 0, a = useA ? act.at(i) : 0, lag = d.values[i - 24];
    if (d.values[i] === null || lag === null || t === null || a === null) continue;
    X.push(feat((p.startHour + i) % 24, t, a, lag)); y.push(d.values[i]);
  }
  const nf = X[0]?.length ?? 0;
  if (X.length < 48 || X.length <= nf + 5) throw new IntelligenceError('INSUFFICIENT_DATA', `Only ${X.length} complete training rows`, { rows: X.length });
  const m = ridgeFit(X, y, 1);
  const res = X.map((r, i) => y[i] - m.predict(r));
  const sigma = Math.max(std(res) * Math.sqrt(X.length / (X.length - nf)), 1e-6);

  // Temperature when no weather forecast is supplied: hour-of-day climatology + decaying persistence of the latest
  // anomaly, with an EMPIRICAL k-step anomaly-error profile that is later folded into the prediction interval.
  let tFut = null, tSigma = null;
  if (useT && !futureTemp) {
    const tv = Array.from({ length: n }, (_, i) => temp.at(i)), c24 = climatology(tv, p.startHour, [24]);
    const an = tv.map((v, i) => (v === null || c24(i) === null ? null : v - c24(i)));
    const pr = []; for (let i = 1; i < n; i++) if (an[i] !== null && an[i - 1] !== null) pr.push([an[i - 1], an[i]]);
    const num = pr.reduce((a, [x, y]) => a + x * y, 0), den = pr.reduce((a, [x]) => a + x * x, 0);
    const phi = den > 0 ? clamp(num / den, 0, 0.999) : 0;
    let last = 0; for (let i = n - 1; i >= Math.max(0, n - 6); i--) if (an[i] !== null) { last = an[i]; break; }
    tFut = (k) => (c24(n + k) ?? 0) + last * phi ** (k + 1);
    tSigma = Array.from({ length: H }, (_, k) => {
      const e = []; for (let i = 0; i + k + 1 < n; i++) if (an[i] !== null && an[i + k + 1] !== null) e.push(an[i + k + 1] - phi ** (k + 1) * an[i]);
      return e.length >= 20 ? std(e) : std(an.filter((v) => v !== null));
    });
    assumptions.push(`future outdoor temperature = hour-of-day climatology + decaying persistence of latest anomaly (phi=${round(phi, 3)}); weather uncertainty added to the interval`);
  }
  const aClim = useA ? climatology(Array.from({ length: n }, (_, i) => act.at(i)), p.startHour) : null;
  if (useA && !futureActivity) assumptions.push('future activity = historical same-hour profile (no schedule supplied)');
  if (!useT) assumptions.push('temperature feature unavailable; model uses time-of-day, activity and lag only');
  const hod = climatology(d.values, p.startHour), ext = d.values.slice();
  for (let k = 0; k < H; k++) {
    const idx = n + k;
    const t = useT ? (futureTemp?.[k] ?? tFut?.(k) ?? 0) : 0, a = useA ? (futureActivity?.[k] ?? aClim(idx) ?? 0) : 0;
    const lag = ext[idx - 24] ?? hod(idx);
    ext.push(Math.max(0, m.predict(feat((p.startHour + idx) % 24, t, a, lag))));
  }
  const ci = 5, bT = useT ? m.coef[ci] : 0;
  const extraSigma = tSigma ? tSigma.map((x) => Math.abs(bT) * x) : null;
  return { values: ext.slice(n), sigma, extraSigma, drivers: { temperatureKwPerDegC: useT ? round(m.coef[ci], 4) : null, activityKwPerUnit: useA ? round(m.coef[ci + (useT ? 1 : 0)], 4) : null }, assumptions, trainRows: X.length };
}

export function forecastDemand(history, { horizonH = 24, asOf, model = 'ridge', futureTemp, futureActivity } = {}) {
  const p = prepare(history, horizonH, asOf);
  const r = model === 'baseline' ? baseline(p, horizonH) : ridge(p, history, horizonH, { futureTemp, futureActivity });
  const meanDemand = mean(valid(p.d.values));
  const points = r.values.map((v, k) => {
    const s0 = r.sigma * (1 + 0.5 * Math.min(1, (k + 1) / MAX_HORIZON)), s = Math.hypot(s0, r.extraSigma?.[k] ?? 0);
    return { offsetH: k + 1, ts: iso(p.lastMs + (k + 1) * HOUR), value: round(v), lower: round(Math.max(0, v - Z80 * s)), upper: round(v + Z80 * s) };
  });
  const m = MODELS[model === 'baseline' ? 'baseline' : 'ridge'];
  return {
    kind: 'forecast', metric: 'demandKw', unit: 'kW', horizonH, asOf: iso(p.lastMs), points, model: m,
    inputWindow: { from: iso(p.d.start), to: iso(p.lastMs), points: p.have, rawMissingFraction: round(p.d.rawMissingFraction, 4), imputedPoints: p.d.imputedCount, trainingRows: r.trainRows },
    uncertainty: { method: 'gaussian-residual', level: 0.8, sigma: round(r.sigma, 4), note: 'heuristic interval from in-sample residuals; check evaluateForecast coverage' },
    confidence: round(clamp(1 - 2 * (r.sigma / Math.max(meanDemand, 1e-6)), 0.1, 0.95) * (1 - p.d.rawMissingFraction), 3),
    drivers: r.drivers, assumptions: r.assumptions, provenance: PROVENANCE.PREDICTED, inputProvenance: history.provenance || null, fallback: null,
  };
}

/** Walk-forward evaluation: truncates history at each origin and scores the next `horizonH` hours against held-out actuals. */
export function evaluateForecast(history, { horizonH = 24, folds = 1, weather = 'actual' } = {}) {
  const full = resampleHourly(history.demandKw), n = full.values.length, end = full.start + (n - 1) * HOUR;
  const A = [], PB = [], PM = [], hits = { baseline: 0, ridge: 0 };
  const temp = alignTo(full, history.outdoorC), act = alignTo(full, history.activity);
  for (let f = folds - 1; f >= 0; f--) {
    const cut = end - (f + 1) * horizonH * HOUR, cutIdx = Math.round((cut - full.start) / HOUR);
    const trunc = (pts) => (pts ? pts.filter((q) => Date.parse(q.ts) <= cut) : pts);
    const train = { demandKw: trunc(history.demandKw), outdoorC: trunc(history.outdoorC), activity: trunc(history.activity), provenance: history.provenance };
    const actual = Array.from({ length: horizonH }, (_, k) => full.values[cutIdx + 1 + k]);
    const fut = { futureTemp: weather === 'actual' && temp ? actual.map((_, k) => temp.at(cutIdx + 1 + k)) : undefined, futureActivity: act ? actual.map((_, k) => act.at(cutIdx + 1 + k)) : undefined };
    const b = forecastDemand(train, { horizonH, model: 'baseline' }), r = forecastDemand(train, { horizonH, model: 'ridge', ...fut });
    actual.forEach((a, k) => { A.push(a); PB.push(b.points[k].value); PM.push(r.points[k].value); if (a >= b.points[k].lower && a <= b.points[k].upper) hits.baseline++; if (a >= r.points[k].lower && a <= r.points[k].upper) hits.ridge++; });
  }
  const baselineM = regressionMetrics(A, PB), modelM = regressionMetrics(A, PM);
  return {
    horizonH, folds, weather, n: A.length, baseline: { ...baselineM, intervalCoverage: round(hits.baseline / A.length, 3) }, model: { ...modelM, intervalCoverage: round(hits.ridge / A.length, 3) },
    maeImprovementPct: round(((baselineM.mae - modelM.mae) / baselineM.mae) * 100, 2), nominalCoverage: 0.8, provenance: history.provenance || null,
    caveat: weather === 'actual' ? 'Uses realised outdoor temperature as the weather forecast: optimistic. Re-run with weather:"climatology".' : 'Uses climatological temperature.',
  };
}

/** Picks baseline vs ridge by walk-forward backtest on the supplied history, so the "improved" model is only used where it has actually won. */
export function forecastDemandAuto(history, opts = {}) {
  const H = opts.horizonH ?? 24;
  let sel;
  try {
    const ev = evaluateForecast(history, { horizonH: H, folds: H <= 24 ? 3 : 2, weather: opts.futureTemp ? 'actual' : 'climatology' });
    sel = { model: ev.model.mae <= ev.baseline.mae ? 'ridge' : 'baseline', backtest: { baselineMae: ev.baseline.mae, modelMae: ev.model.mae, folds: ev.folds, weather: ev.weather } };
    sel.reason = sel.model === 'ridge' ? 'improved model beat baseline in walk-forward backtest' : 'baseline beat improved model in walk-forward backtest';
  } catch (e) {
    if (e.code !== 'INSUFFICIENT_DATA') throw e;
    sel = H > 24 ? { model: 'baseline', reason: 'history too short to validate improved model at this horizon' } : { model: 'ridge', reason: 'history too short to backtest; improved model unvalidated' };
  }
  const f = forecastDemand(history, { ...opts, model: sel.model });
  f.selection = sel;
  return f;
}
