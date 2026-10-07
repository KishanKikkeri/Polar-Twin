// Reproducible evaluation on SYNTHETIC data. Numbers describe model behaviour on this generator, not on real stations.
import { generateSyntheticStation, evaluateForecast, evaluateAnomalyDetector, classificationMetrics, evaluateDepletion } from '../src/intelligence/index.js';
const out = { dataset: 'SYNTHETIC (seeded)', forecast: {}, anomaly: {}, depletion: {} };
const d = generateSyntheticStation({ seed: 7, days: 35 });
const h = { demandKw: d.series.demandKw, outdoorC: d.series.outdoorC, activity: d.series.activity, provenance: 'SYNTHETIC' };
for (const [H, folds] of [[24, 4], [168, 2]]) for (const w of ['actual', 'climatology']) {
  const e = evaluateForecast(h, { horizonH: H, folds, weather: w });
  out.forecast[`${H}h/${w}-weather`] = { baseline: e.baseline, model: e.model, maeImprovementPct: e.maeImprovementPct };
}
const idx = [110, 150, 200, 245, 300, 330, 380, 420], tot = { tp: 0, fp: 0, fn: 0, tn: 0 };
for (const [ch, mag] of [['demandKw', 45], ['DG-1.exhaustTempC', 30], ['commsLatencyMs', 200], ['windMs', 12]]) {
  const per = [];
  for (const seed of [3, 8]) {
    const s = generateSyntheticStation({ seed, days: 21, injected: idx.map((i, k) => ({ i, channel: ch, delta: (k % 2 ? -1 : 1) * mag })) });
    const m = evaluateAnomalyDetector({ assetId: 'X', channel: ch.split('.').pop(), points: s.series[ch] }, s.labels[ch], { from: 96 });
    per.push(m); for (const k of Object.keys(tot)) tot[k] += m[k];
  }
  out.anomaly[ch] = per;
}
out.anomaly.pooled = classificationMetrics(tot);
const f = generateSyntheticStation({ seed: 5, days: 14 }), zero = f.series.fuelL.find((p) => p.value <= 0).ts;
out.depletion = evaluateDepletion(f.series.fuelL, '2026-01-10T00:00:00.000Z', zero);
console.log(JSON.stringify(out, null, 2));
