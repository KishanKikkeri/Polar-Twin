// Agent 4B — shared primitives: provenance, errors, metrics, linear algebra, resampling, hashing.
export const HOUR = 3600000;
export const PROVENANCE = Object.freeze({
  REAL_OBSERVATION: 'REAL_OBSERVATION', SYNTHETIC: 'SYNTHETIC', DERIVED: 'DERIVED',
  PREDICTED: 'PREDICTED', SIMULATED: 'SIMULATED', SCENARIO: 'SCENARIO',
});

export class IntelligenceError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'IntelligenceError'; this.code = code; this.details = details; }
}

export const round = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? (n ?? null) : Math.round(n * 10 ** d) / 10 ** d);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const iso = (ms) => new Date(ms).toISOString();
export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
export const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
export const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export const mad = (a) => { const m = median(a); return median(a.map((v) => Math.abs(v - m))); };

// ---- evaluation metrics ----
export function regressionMetrics(actual, pred) {
  const pairs = actual.map((a, i) => [a, pred[i]]).filter(([a, p]) => Number.isFinite(a) && Number.isFinite(p));
  if (!pairs.length) return { n: 0, mae: null, rmse: null, mape: null, mapeSkipped: 0 };
  const mae = mean(pairs.map(([a, p]) => Math.abs(a - p)));
  const rmse = Math.sqrt(mean(pairs.map(([a, p]) => (a - p) ** 2)));
  const nz = pairs.filter(([a]) => a !== 0); // MAPE undefined at actual = 0: skipped and reported, never divided
  return { n: pairs.length, mae: round(mae, 4), rmse: round(rmse, 4), mape: nz.length ? round(mean(nz.map(([a, p]) => Math.abs((a - p) / a))) * 100, 4) : null, mapeSkipped: pairs.length - nz.length };
}
export function classificationMetrics({ tp, fp, fn, tn }) {
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, precision: round(precision, 4), recall: round(recall, 4), f1: round(f1, 4), falsePositiveRate: fp + tn ? round(fp / (fp + tn), 4) : null };
}

// ---- deterministic randomness (synthetic data only; models never use it) ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const gaussian = (rng) => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());

// ---- ridge regression (closed form, standardised features, unpenalised intercept) ----
export function ridgeFit(X, y, lambda = 1) {
  const n = X.length, p = X[0].length;
  const mu = Array(p).fill(0), sd = Array(p).fill(1);
  for (let j = 1; j < p; j++) { mu[j] = mean(X.map((r) => r[j])); sd[j] = std(X.map((r) => r[j])) || 1; }
  const Z = X.map((r) => r.map((v, j) => (j === 0 ? 1 : (v - mu[j]) / sd[j])));
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j && i > 0 ? lambda : 0)));
  const b = Array(p).fill(0);
  for (let r = 0; r < n; r++) for (let i = 0; i < p; i++) { b[i] += Z[r][i] * y[r]; for (let j = 0; j < p; j++) A[i][j] += Z[r][i] * Z[r][j]; }
  const w = solve(A, b);
  const coef = w.map((v, j) => (j === 0 ? 0 : v / sd[j]));
  coef[0] = w[0] - w.slice(1).reduce((s, v, j) => s + (v * mu[j + 1]) / sd[j + 1], 0);
  return { coef, predict: (x) => x.reduce((s, v, j) => s + v * coef[j], 0) };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) throw new IntelligenceError('SINGULAR', 'Feature matrix is singular');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// ---- hourly resampling with bounded gap interpolation ----
export function resampleHourly(points, { maxGapH = 6 } = {}) {
  const clean = (points || []).filter((p) => p && Number.isFinite(p.value) && Number.isFinite(Date.parse(p.ts))).map((p) => ({ t: Math.floor(Date.parse(p.ts) / HOUR), v: p.value })).sort((a, b) => a.t - b.t);
  if (!clean.length) return { start: null, values: [], imputed: [], rawMissingFraction: 1, missingFraction: 1, imputedCount: 0 };
  const start = clean[0].t, n = clean[clean.length - 1].t - start + 1;
  const values = Array(n).fill(null), imputed = Array(n).fill(false);
  clean.forEach((p) => { values[p.t - start] = p.v; });
  const rawMissing = values.filter((v) => v === null).length;
  let i = 0;
  while (i < n) {
    if (values[i] !== null) { i++; continue; }
    let j = i; while (j < n && values[j] === null) j++;
    if (i > 0 && j < n && j - i <= maxGapH) for (let k = i; k < j; k++) { values[k] = values[i - 1] + ((values[j] - values[i - 1]) * (k - i + 1)) / (j - i + 1); imputed[k] = true; }
    i = j;
  }
  const missing = values.filter((v) => v === null).length;
  return { start: start * HOUR, values, imputed, rawMissingFraction: rawMissing / n, missingFraction: missing / n, imputedCount: imputed.filter(Boolean).length };
}

// ---- content hash / metadata ----
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export function hash(v) {
  const s = canonical(v); let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
export const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
export const MODELS = Object.freeze({
  baseline: { name: 'seasonal-naive', version: '1.0.0' }, ridge: { name: 'ridge-energy', version: '1.0.0' },
  anomaly: { name: 'robust-seasonal-zscore', version: '1.0.0' }, maintenance: { name: 'health-trend-index', version: '1.0.0' },
  logistics: { name: 'burn-rate-linear', version: '1.0.0' }, risk: { name: 'evidence-noisy-or', version: '1.0.0' }, optimizer: { name: 'rule-optimizer', version: '1.0.0' },
});
