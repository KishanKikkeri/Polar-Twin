import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  regressionMetrics, classificationMetrics, IntelligenceError, deepFreeze, PROVENANCE,
  forecastDemand, forecastDemandAuto, evaluateForecast, predictDepletion, evaluateDepletion, estimateBurnRate, predictConsumption,
  detectAnomalies, evaluateAnomalyDetector, predictMaintenance, computeRisk, domainScore, severityOf, recommend,
  createMemoryStore, createFileStore, createIntelligenceService, generateSyntheticStation, createSyntheticTelemetryProvider,
} from '../../src/intelligence/index.js';

const ASOF = '2026-02-01T00:00:00.000Z';
const hist = (d) => ({ demandKw: d.series.demandKw, outdoorC: d.series.outdoorC, activity: d.series.activity, provenance: d.provenance });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const station = (over = {}) => ({
  stationId: 'x', asOf: ASOF, assets: [{ id: 'DG-1', type: 'generator', status: 'online', capacityKw: 300 }, { id: 'DG-2', type: 'generator', status: 'online', capacityKw: 300 }, { id: 'COM-1', type: 'comms', status: 'online' }],
  energy: { baseDemandKw: 200, batteryKwh: 800, batteryCapacityKwh: 1000 }, environment: { outdoorC: -10, windMs: 6 }, alerts: [], ...over,
});

describe('metrics', () => {
  test('MAE / RMSE / MAPE are computed correctly; MAPE skips zero actuals and says so', () => {
    const m = regressionMetrics([100, 200], [110, 180]);
    assert.equal(m.mae, 15); assert.equal(m.rmse, 15.8114); assert.equal(m.mape, 10);
    const z = regressionMetrics([0, 100], [5, 90]);
    assert.equal(z.mapeSkipped, 1); assert.equal(z.mape, 10);
  });
  test('precision / recall / F1 / FPR', () => {
    const c = classificationMetrics({ tp: 8, fp: 2, fn: 2, tn: 88 });
    assert.equal(c.precision, 0.8); assert.equal(c.recall, 0.8); assert.equal(c.f1, 0.8); assert.equal(c.falsePositiveRate, 0.0222);
  });
});

describe('forecasting', () => {
  const d = generateSyntheticStation({ seed: 7, days: 35 });
  const h = hist(d);

  test('improved model beats baseline (24 h and 7 d) when given a weather forecast', () => {
    for (const H of [24, 168]) {
      const e = evaluateForecast(h, { horizonH: H, folds: H === 24 ? 4 : 2, weather: 'actual' });
      assert.ok(e.model.mae < 0.6 * e.baseline.mae, `H=${H} model ${e.model.mae} vs baseline ${e.baseline.mae}`);
      assert.ok(e.maeImprovementPct > 40);
      for (const k of ['mae', 'rmse', 'mape']) assert.ok(Number.isFinite(e.model[k]) && Number.isFinite(e.baseline[k]));
      assert.match(e.caveat, /optimistic/);
    }
  });
  test('without a weather forecast: wins at 24 h, intervals roughly calibrated; 7 d is NOT assumed to win', () => {
    const e24 = evaluateForecast(h, { horizonH: 24, folds: 4, weather: 'climatology' });
    assert.ok(e24.model.mae < e24.baseline.mae);
    assert.ok(e24.model.intervalCoverage > 0.6 && e24.model.intervalCoverage < 0.95, `coverage ${e24.model.intervalCoverage}`);
    const auto = forecastDemandAuto(h, { horizonH: 168 });
    const bt = auto.selection.backtest;
    assert.equal(auto.selection.model === 'ridge', bt.modelMae <= bt.baselineMae); // selection obeys the backtest, whatever it says
  });
  test('deterministic: same input -> identical output', () => {
    assert.deepEqual(forecastDemand(h, { horizonH: 24 }), forecastDemand(h, { horizonH: 24 }));
    assert.deepEqual(forecastDemandAuto(h, { horizonH: 24 }), forecastDemandAuto(h, { horizonH: 24 }));
  });
  test('inputs are never mutated', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(h)));
    assert.doesNotThrow(() => forecastDemand(frozen, { horizonH: 24 }));
  });
  test('provenance, model/version, input window, timestamp, confidence, uncertainty are always present', () => {
    const f = forecastDemand(h, { horizonH: 24 });
    assert.equal(f.provenance, PROVENANCE.PREDICTED); assert.equal(f.inputProvenance, PROVENANCE.SYNTHETIC);
    assert.ok(f.model.name && f.model.version); assert.ok(f.inputWindow.from && f.inputWindow.to && f.inputWindow.points > 0);
    assert.ok(f.asOf); assert.ok(f.confidence > 0 && f.confidence <= 1);
    assert.ok(f.uncertainty.level === 0.8 && f.uncertainty.sigma > 0);
    assert.equal(f.points.length, 24);
    assert.ok(f.points.every((p) => p.lower <= p.value && p.value <= p.upper && p.offsetH >= 1));
    assert.ok(f.points[0].offsetH === 1 && Date.parse(f.points[0].ts) > Date.parse(f.asOf)); // predictions are strictly after the last observation
    assert.ok(f.assumptions.some((a) => /persistence/.test(a)));
  });
  test('insufficient data: too short, too gappy, stale, bad horizon -> explicit errors, no numbers', () => {
    const short = { demandKw: d.series.demandKw.slice(0, 40) };
    assert.equal(code(() => forecastDemand(short, { horizonH: 24 })), 'INSUFFICIENT_DATA');
    assert.equal(code(() => forecastDemand({ demandKw: d.series.demandKw.slice(0, 200) }, { horizonH: 168 })), 'INSUFFICIENT_DATA'); // 7-day needs >= 336 h
    const gappy = { demandKw: d.series.demandKw.filter((_, i) => i % 7 !== 0 && i % 7 !== 1 && i % 7 !== 2 && i % 7 !== 3 && i % 7 !== 4 && i % 7 !== 5) };
    assert.equal(code(() => forecastDemand(gappy, { horizonH: 24 })), 'INSUFFICIENT_DATA');
    assert.equal(code(() => forecastDemand(h, { horizonH: 24, asOf: '2026-03-30T00:00:00Z' })), 'INSUFFICIENT_DATA');
    assert.equal(code(() => forecastDemand(h, { horizonH: 500 })), 'INVALID_HORIZON');
    assert.equal(code(() => forecastDemand({}, { horizonH: 24 })), 'INSUFFICIENT_DATA');
  });
  test('missing data: short gaps interpolated, long gaps tolerated, output has no NaN, confidence is lower', () => {
    const full = forecastDemand(h, { horizonH: 24 });
    const holes = { ...h, demandKw: h.demandKw.filter((_, i) => ![100, 101, 300, 500, 501, 502, 640].includes(i) && !(i >= 400 && i < 412)) };
    const f = forecastDemand(holes, { horizonH: 24 });
    assert.ok(f.inputWindow.imputedPoints >= 7 && f.inputWindow.rawMissingFraction > 0);
    assert.ok(f.points.every((p) => Number.isFinite(p.value) && Number.isFinite(p.lower) && Number.isFinite(p.upper)));
    assert.ok(f.confidence < full.confidence);
  });
  test('missing temperature series: still forecasts, and says what it did not use', () => {
    const f = forecastDemand({ demandKw: h.demandKw, activity: h.activity, provenance: h.provenance }, { horizonH: 24 });
    assert.equal(f.drivers.temperatureKwPerDegC, null);
    assert.ok(f.assumptions.some((a) => /temperature feature unavailable/.test(a)));
  });
  test('no forecast is produced for a negative demand value', () => {
    assert.ok(forecastDemand(h, { horizonH: 168, model: 'baseline' }).points.every((p) => p.lower >= 0));
  });
});

describe('logistics', () => {
  const d = generateSyntheticStation({ seed: 5, days: 14 });
  const fuel = d.series.fuelL;
  const zero = fuel.find((p) => p.value <= 0).ts;

  test('depletion-date error is measured and small; truth lies inside the stated interval', () => {
    const e = evaluateDepletion(fuel, '2026-01-10T00:00:00.000Z', zero);
    assert.ok(e.absErrorHours < 12, `error ${e.absErrorHours} h`);
    assert.ok(e.relativeErrorPct < 8, `rel ${e.relativeErrorPct}%`);
    assert.equal(e.withinInterval, true);
  });
  test('refuel events do not distort the burn rate', () => {
    const plain = generateSyntheticStation({ seed: 5, days: 8 }), refueled = generateSyntheticStation({ seed: 5, days: 8, refuel: { i: 100, litres: 6000 } });
    const a = estimateBurnRate(plain.series.fuelL).burnLph, b = estimateBurnRate(refueled.series.fuelL).burnLph;
    assert.ok(Math.abs(a - b) / a < 0.02);
  });
  test('days of autonomy, depletion range, and resupply risk levels', () => {
    const pts = fuel.filter((p) => Date.parse(p.ts) <= Date.parse('2026-01-10T00:00:00Z'));
    const base = predictDepletion(pts);
    assert.ok(base.daysOfAutonomy > 3 && base.daysOfAutonomy < 8);
    assert.ok(base.depletion.earliestTs < base.depletion.ts && base.depletion.ts < base.depletion.latestTs);
    assert.equal(base.provenance, PROVENANCE.PREDICTED);
    const late = predictDepletion(pts, { resupplyEtaTs: '2026-01-30T00:00:00Z' });
    const early = predictDepletion(pts, { resupplyEtaTs: '2026-01-10T12:00:00Z' });
    assert.equal(late.resupplyRisk.level, 'critical'); assert.equal(early.resupplyRisk.level, 'low');
    assert.equal(base.resupplyRisk.level, 'unknown');
  });
  test('insufficient fuel history -> error; no consumption -> explicit status', () => {
    assert.equal(code(() => predictDepletion(fuel.slice(0, 10))), 'INSUFFICIENT_DATA');
    const flat = fuel.slice(0, 60).map((p) => ({ ...p, value: 5000 }));
    assert.equal(predictDepletion(flat).status, 'no_consumption');
  });
  test('consumption forecast uses measured litres/kWh, not an assumed constant', () => {
    const f = forecastDemand(hist(d), { horizonH: 24, model: 'baseline' });
    const c = predictConsumption(f, fuel, d.series.demandKw);
    assert.ok(Math.abs(c.litresPerKwh - 0.28) < 0.003);
    assert.ok(c.points.at(-1).cumulativeL > 0 && c.points.at(-1).lowerL < c.points.at(-1).cumulativeL);
  });
});

describe('anomaly detection', () => {
  const idx = [110, 150, 200, 245, 300, 330, 380, 420];
  const run = (ch, mag, seed) => {
    const inj = idx.map((i, k) => ({ i, channel: ch, delta: (k % 2 ? -1 : 1) * mag }));
    const s = generateSyntheticStation({ seed, days: 21, injected: inj });
    return evaluateAnomalyDetector({ assetId: 'X', channel: ch.split('.').pop(), points: s.series[ch] }, s.labels[ch], { from: 96 });
  };
  test('evaluation on injected anomalies (pooled over channels and seeds)', () => {
    const tot = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const [ch, mag] of [['demandKw', 45], ['DG-1.exhaustTempC', 30], ['commsLatencyMs', 200], ['windMs', 12]]) for (const seed of [3, 8]) { const m = run(ch, mag, seed); for (const k of Object.keys(tot)) tot[k] += m[k]; }
    const m = classificationMetrics(tot);
    assert.ok(m.recall >= 0.8, `recall ${m.recall}`); assert.ok(m.precision >= 0.8, `precision ${m.precision}`);
    assert.ok(m.f1 >= 0.8, `f1 ${m.f1}`); assert.ok(m.falsePositiveRate <= 0.01, `fpr ${m.falsePositiveRate}`);
  });
  test('clean data produces (almost) no alarms', () => {
    const s = generateSyntheticStation({ seed: 21, days: 21 });
    const r = detectAnomalies({ assetId: 'DG-1', channel: 'exhaustTempC', points: s.series['DG-1.exhaustTempC'] });
    assert.ok(r.anomalies.length <= 1);
  });
  test('every anomaly carries asset/channel, timestamp, severity, observed, expected, range, confidence, model, reason', () => {
    const s = generateSyntheticStation({ seed: 3, days: 14, injected: [{ i: 200, channel: 'DG-1.exhaustTempC', delta: 80 }] });
    const a = detectAnomalies({ assetId: 'DG-1', channel: 'exhaustTempC', points: s.series['DG-1.exhaustTempC'], provenance: 'SYNTHETIC' }).anomalies[0];
    for (const k of ['assetId', 'channel', 'ts', 'severity', 'observed', 'expected', 'expectedRange', 'confidence', 'model', 'reason', 'provenance']) assert.ok(a[k] !== undefined, k);
    assert.ok(a.observed > a.expectedRange.high); assert.ok(a.model.version); assert.equal(a.inputProvenance, 'SYNTHETIC'); assert.match(a.reason, /robust σ/);
  });
  test('hard physical limit is critical regardless of statistics', () => {
    const s = generateSyntheticStation({ seed: 3, days: 14, injected: [{ i: 250, channel: 'DG-1.loading', delta: 0.9 }] });
    const a = detectAnomalies({ assetId: 'DG-1', channel: 'loading', points: s.series['DG-1.loading'] }).anomalies.find((x) => /hard limit/.test(x.reason));
    assert.equal(a.severity, 'critical');
  });
  test('insufficient data, unknown channel, and deterministic output', () => {
    const s = generateSyntheticStation({ seed: 3, days: 14 });
    assert.equal(detectAnomalies({ channel: 'demandKw', points: s.series.demandKw.slice(0, 30) }).reason, 'insufficient_data');
    assert.equal(detectAnomalies({ channel: 'flux_capacitor', points: s.series.demandKw }).reason, 'unknown_channel');
    const a = { channel: 'demandKw', points: s.series.demandKw };
    assert.deepEqual(detectAnomalies(a), detectAnomalies(a));
  });
  test('missing data: interpolated points are never flagged as anomalies', () => {
    const s = generateSyntheticStation({ seed: 3, days: 14 });
    const holed = s.series['DG-1.exhaustTempC'].filter((_, i) => ![150, 151, 152].includes(i));
    const r = detectAnomalies({ assetId: 'DG-1', channel: 'exhaustTempC', points: holed });
    const t = (i) => s.series['DG-1.exhaustTempC'][i].ts;
    assert.ok(!r.anomalies.some((a) => [t(150), t(151), t(152)].includes(a.ts)));
  });
});

describe('predictive maintenance', () => {
  test('degrading generator: low health, worsening trajectory, urgent, specific inspection, reason', () => {
    const s = generateSyntheticStation({ seed: 4, days: 21, drift: { exhaustTempPerDay: 6, loadingPerDay: 0.012 } });
    const m = predictMaintenance({ assetId: 'DG-1', assetType: 'generator', indicators: { exhaustTempC: s.series['DG-1.exhaustTempC'], loading: s.series['DG-1.loading'] } });
    assert.equal(m.urgency, 'urgent'); assert.ok(m.healthIndex < 60);
    const hs = m.healthTrajectory.map((x) => x.healthIndex); assert.ok(hs[0] >= hs[1] && hs[1] >= hs[2]);
    assert.ok(m.recommendedInspection && m.reason && m.confidence > 0 && m.dueInDays <= 7);
    assert.match(m.riskNote, /not a calibrated/); assert.equal(m.provenance, PROVENANCE.PREDICTED);
  });
  test('healthy generator -> routine, high health', () => {
    const s = generateSyntheticStation({ seed: 4, days: 21 });
    const m = predictMaintenance({ assetId: 'DG-1', assetType: 'generator', indicators: { exhaustTempC: s.series['DG-1.exhaustTempC'], loading: s.series['DG-1.loading'] } });
    assert.equal(m.urgency, 'routine'); assert.ok(m.healthIndex > 60);
  });
  test('does not invent sensors: only supplied indicators are used, absent ones are listed as missing', () => {
    const s = generateSyntheticStation({ seed: 4, days: 21 });
    const m = predictMaintenance({ assetId: 'DG-1', assetType: 'generator', indicators: { loading: s.series['DG-1.loading'], vibrationMmS: s.series.demandKw } });
    assert.deepEqual(m.usedIndicators, ['loading']);
    assert.ok(m.missingIndicators.some((x) => x.indicator === 'exhaustTempC'));
    assert.ok(!JSON.stringify(m).includes('vibration'));
    const none = predictMaintenance({ assetId: 'DG-2', assetType: 'generator', indicators: {} });
    assert.equal(none.status, 'insufficient_data'); assert.equal(none.healthIndex, null); assert.equal(none.failureRisk30d, null);
  });
  test('generator indicators are not applied to a comms asset', () => {
    const s = generateSyntheticStation({ seed: 4, days: 21 });
    const m = predictMaintenance({ assetId: 'COM-1', assetType: 'comms', indicators: { loading: s.series['DG-1.loading'], commsLatencyMs: s.series.commsLatencyMs } });
    assert.deepEqual(m.usedIndicators, ['commsLatencyMs']);
  });
});

describe('risk engine', () => {
  const fc = (conf = 0.8, peak = 280) => ({ horizonH: 24, confidence: conf, model: { name: 'm', version: '1' }, points: [{ value: peak - 20, upper: peak }, { value: peak - 40, upper: peak - 10 }] });
  test('consistent: score reproducible from factors; station between mean and max of domains', () => {
    const r = computeRisk({ state: station({ energy: { baseDemandKw: 540, batteryKwh: 300, batteryCapacityKwh: 1000 }, alerts: [{ severity: 'critical' }] }), demandForecast: fc() });
    for (const dname of Object.keys(r.domains)) assert.equal(r.domains[dname].score, domainScore(r.domains[dname].factors));
    const known = Object.values(r.domains).map((x) => x.score).filter((s) => s !== null);
    assert.ok(r.score <= Math.max(...known) && r.score >= known.reduce((a, b) => a + b, 0) / known.length - 1);
    assert.equal(r.severity, severityOf(r.score)); assert.ok(r.factors.every((f) => f.effective <= f.risk + 1e-9));
  });
  test('monotonic: worse evidence never lowers the score', () => {
    const a = computeRisk({ state: station() }), b = computeRisk({ state: station({ energy: { baseDemandKw: 200, batteryKwh: 200, batteryCapacityKwh: 1000 } }) });
    const c = computeRisk({ state: station({ energy: { baseDemandKw: 200, batteryKwh: 200, batteryCapacityKwh: 1000 } }), anomalies: [{ kind: 'equipment', assetId: 'DG-1', channel: 'exhaustTempC', severity: 'critical', observed: 1, expected: 1, ts: ASOF, confidence: 0.9 }] });
    assert.ok(b.score >= a.score && c.score >= b.score); assert.ok(c.domains.equipment.score > 0);
  });
  test('no evidence is "unknown", not "low"; unavailable domains do not drag the score down', () => {
    const r = computeRisk({ state: station() });
    assert.equal(r.domains.logistics.score, null); assert.equal(r.domains.logistics.severity, 'unknown');
    assert.equal(r.domains.equipment.severity, 'unknown'); assert.ok(r.domainsWithEvidence < 5);
    assert.equal(computeRisk({ state: null }).score, null);
  });
  test('current state is read, never replaced by predictions; predicted evidence is labelled and confidence-weighted', () => {
    const st = deepFreeze(station());
    const r = computeRisk({ state: st, demandForecast: fc(0.5, 400) });
    assert.ok(r.factors.filter((f) => f.source === 'twin.state').every((f) => f.provenance === PROVENANCE.DERIVED));
    const pf = r.factors.find((f) => f.id === 'forecast_peak');
    assert.equal(pf.provenance, PROVENANCE.PREDICTED); assert.equal(pf.confidence, 0.5); assert.ok(pf.effective <= pf.risk * 0.5 + 1e-3);
    assert.equal(st.energy.baseDemandKw, 200); // untouched (frozen: a write would have thrown)
    assert.ok(!('assets' in r) && !('energy' in r));
  });
  test('trend from previous score; confidence present', () => {
    const base = computeRisk({ state: station() });
    assert.equal(computeRisk({ state: station(), previous: { score: base.score - 10 } }).trend, 'rising');
    assert.equal(computeRisk({ state: station(), previous: { score: base.score + 10 } }).trend, 'falling');
    assert.equal(computeRisk({ state: station(), previous: { score: base.score } }).trend, 'stable');
    assert.equal(base.trend, 'unknown'); assert.ok(base.confidence > 0);
  });
});

describe('recommendations', () => {
  const fcast = { horizonH: 24, confidence: 0.8, drivers: { temperatureKwPerDegC: -2 }, points: [{ ts: '2026-02-01T11:00:00Z', value: 560, upper: 590 }, { ts: '2026-02-01T23:00:00Z', value: 300, upper: 330 }] };
  const logi = { status: 'ok', asOf: ASOF, levelL: 6000, burnLph: 50, confidence: 0.8, depletion: { earliestTs: '2026-02-05T00:00:00Z' }, resupplyRisk: { level: 'high', etaTs: '2026-02-08T00:00:00Z', safetyMarginH: 48, earliestMarginHours: -72, reason: 'Fuel is expected to last 120 h; resupply in 168 h' } };
  test('every recommendation carries evidence-backed explanations', () => {
    const st = station({ energy: { baseDemandKw: 700, batteryKwh: 800, batteryCapacityKwh: 1000 } });
    const risk = computeRisk({ state: st, demandForecast: fcast, logistics: logi });
    const recs = recommend({ state: st, demandForecast: fcast, logistics: logi, risk, maintenance: [{ status: 'ok', assetId: 'DG-1', urgency: 'urgent', recommendedInspection: 'Inspect cooling', dueInDays: 3, reason: 'exhaust temp rising', healthIndex: 40, failureRisk30d: 0.7, confidence: 0.8 }] });
    const types = new Set(recs.map((r) => r.type));
    for (const t of ['load_reduction', 'fuel_conservation', 'resupply_timing', 'energy_redistribution', 'heating_adjustment', 'maintenance_inspection']) assert.ok(types.has(t), t);
    for (const r of recs) { assert.ok(r.why.length > 0); assert.ok(r.why.every((w) => w.claim && w.evidence.length > 0 && w.evidence.every((e) => e.ref && e.value !== undefined && e.provenance))); assert.ok(r.model.version && r.provenance); }
    assert.deepEqual(recs.map((r) => r.priority), [...recs.map((r) => r.priority)].sort((a, b) => a - b));
  });
  test('quantities are plain arithmetic on the evidence', () => {
    const st = station({ energy: { baseDemandKw: 700, batteryKwh: 800, batteryCapacityKwh: 1000 } }); // online cap 600
    const recs = recommend({ state: st, demandForecast: fcast, logistics: logi });
    assert.equal(recs.find((r) => r.priority === 1 && r.type === 'load_reduction').quantified.reduceKw, 100); // 700 - 600
    const peak = recs.find((r) => r.type === 'load_reduction' && r.priority === 2).quantified.reduceKw;
    assert.equal(peak, 50); // 590 - 0.9*600
    const f = recs.find((r) => r.type === 'fuel_conservation').quantified; // 6000 L over (168 h + 48 h) = 27.78 L/h vs 50 L/h
    assert.equal(f.targetBurnLph, 27.78); assert.equal(f.burnReductionPct, 44.4);
  });
  test('healthy station -> no alarmist recommendations, nothing invented', () => {
    const recs = recommend({ state: station(), logistics: { ...logi, resupplyRisk: { level: 'low', etaTs: '2026-02-03T00:00:00Z', safetyMarginH: 48, earliestMarginHours: 400, reason: 'ample margin' } } });
    assert.ok(recs.every((r) => r.priority >= 9 && r.type === 'resupply_timing'));
  });
});

describe('service: fallback, persistence, provenance, partial evidence', () => {
  const data = generateSyntheticStation({ seed: 11, days: 28, refuel: { i: 200, litres: 9000 }, injected: [{ i: 24 * 27 + 5, channel: 'DG-1.exhaustTempC', delta: 90 }] });
  const twin = { async getState(id, { asOf }) { return { ...station(), stationId: id, asOf, logistics: { nextResupplyH: 120 }, alerts: [{ id: 'a', severity: 'warning', category: 'x', message: 'm' }] }; } };
  const mk = (o = {}) => createIntelligenceService({ telemetry: createSyntheticTelemetryProvider(data, o.telemetry), twin, store: o.store, models: o.models });

  test('model failure -> baseline fallback, flagged, still PREDICTED with model/version', async () => {
    const svc = mk({ models: { forecastAuto: () => { throw new Error('model blew up'); } } });
    const f = await svc.getForecast('maitri', { asOf: ASOF, horizonH: 24 });
    assert.equal(f.fallback.used, true); assert.match(f.fallback.reason, /blew up/); assert.equal(f.fallback.attempted, 'ridge-energy');
    assert.equal(f.model.name, 'seasonal-naive'); assert.equal(f.provenance, PROVENANCE.PREDICTED); assert.equal(f.points.length, 24);
  });
  test('normal path is not marked as fallback; model selection is explained', async () => {
    const f = await mk().getForecast('maitri', { asOf: ASOF, horizonH: 24 });
    assert.equal(f.fallback, null); assert.ok(f.selection.reason);
  });
  test('baseline also impossible -> INSUFFICIENT_DATA (no invented forecast); telemetry down -> TELEMETRY_UNAVAILABLE', async () => {
    const short = createIntelligenceService({ telemetry: createSyntheticTelemetryProvider({ ...data, series: { demandKw: data.series.demandKw.slice(0, 30) } }), twin });
    await assert.rejects(short.getForecast('m', { asOf: '2026-01-06T05:00:00.000Z' }), (e) => e.code === 'INSUFFICIENT_DATA');
    const down = createIntelligenceService({ telemetry: { async getTelemetry() { throw Object.assign(new Error('x'), { code: 'DEPENDENCY_UNAVAILABLE' }); } }, twin });
    await assert.rejects(down.getForecast('m', { asOf: ASOF }), (e) => e.code === 'TELEMETRY_UNAVAILABLE');
    await assert.rejects(mk().getForecast('m', { asOf: ASOF, metric: 'batteryKwh' }), (e) => e.code === 'UNSUPPORTED_METRIC');
  });
  test('as_of discipline: telemetry after asOf is never used', async () => {
    const early = await mk().getForecast('m', { asOf: '2026-01-25T00:00:00.000Z', horizonH: 24 });
    assert.equal(early.asOf, '2026-01-25T00:00:00.000Z'); assert.ok(early.inputWindow.to <= early.asOf);
  });
  test('risk with missing forecast input still computes from state and reports what was unavailable', async () => {
    const svc = mk({ telemetry: { drop: ['demandKw'] } });
    const r = await svc.getRisk('m', { asOf: ASOF });
    assert.ok(r.unavailableInputs.some((u) => u.input === 'demandForecast'));
    assert.ok(!r.factors.some((f) => f.id === 'forecast_peak')); assert.ok(r.score !== null);
  });
  test('persistence: every output is stored, idempotent, readable, and the store cannot write twin state', async () => {
    const store = createMemoryStore(), svc = mk({ store });
    await svc.getForecast('m', { asOf: ASOF }); const n1 = store.count();
    await svc.getForecast('m', { asOf: ASOF }); assert.equal(store.count(), n1);
    await svc.getRisk('m', { asOf: ASOF }); await svc.getRecommendations('m', { asOf: ASOF });
    for (const k of ['forecast', 'risk', 'recommendations', 'anomalies', 'logistics']) assert.ok(store.latest('m', k), k);
    assert.ok(store.latest('m', 'forecast').provenance === 'PREDICTED');
    assert.deepEqual(Object.keys(store).sort(), ['count', 'latest', 'list', 'save']);
    const r2 = await svc.getRisk('m', { asOf: '2026-02-01T06:00:00.000Z' }); assert.ok(['stable', 'rising', 'falling'].includes(r2.trend)); // uses stored previous
  });
  test('file store round-trips across instances', async () => {
    const p = path.join(os.tmpdir(), `pt4b-${Date.now()}.jsonl`);
    const a = createFileStore(p); await createIntelligenceService({ telemetry: createSyntheticTelemetryProvider(data), twin, store: a }).getLogistics('m', { asOf: ASOF });
    const b = createFileStore(p); assert.equal(b.count(), a.count()); assert.equal(b.latest('m', 'logistics').kind, 'logistics'); fs.unlinkSync(p);
    assert.throws(() => a.save({ kind: 'x' }), TypeError);
  });
  test('all five contract objects expose model/version, timestamp and provenance', async () => {
    const svc = mk(), o = { asOf: ASOF };
    const all = [await svc.getForecast('m', o), await svc.getRisk('m', o), await svc.getRecommendations('m', o), await svc.getAnomaliesDetailed('m', o), ...(await svc.getMaintenanceDetailed('m', o)), await svc.getLogistics('m', o)];
    for (const e of all) { assert.ok(e.model?.name && e.model?.version, e.kind); assert.ok(e.asOf && e.generatedAt, e.kind); assert.ok(Object.values(PROVENANCE).includes(e.provenance), e.kind); }
  });
});

describe('compatibility with Agent 4C copilot (consumed without importing ML internals)', async () => {
  let mod = null; try { mod = await import('../../src/decision/index.js'); } catch { /* 4C not present */ }
  test('4C copilot answers forecast/anomaly/maintenance/risk from the 4B service, grounded', { skip: !mod }, async () => {
    const data = generateSyntheticStation({ seed: 11, days: 28, injected: [{ i: 24 * 27 + 5, channel: 'DG-1.exhaustTempC', delta: 90 }] });
    const svc = createIntelligenceService({ telemetry: createSyntheticTelemetryProvider(data), twin: mod.createMockTwinProvider() });
    const cp = mod.createCopilot({ twin: mod.createMockTwinProvider(), predictions: svc });
    for (const q of ['forecast demand', 'any anomalies?', 'maintenance due?', 'what is the risk?']) {
      const r = await cp.ask(q, { stationId: 'maitri', asOf: ASOF });
      assert.equal(r.status, 'ok', `${q}: ${r.answer}`);
      assert.deepEqual(mod.assertGrounded(r).ungrounded, [], `${q}: ${r.answer}`);
    }
  });
});
