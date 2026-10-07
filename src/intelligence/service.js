// Agent 4B — intelligence service: the ONLY surface Agent 4C needs. Pulls telemetry/state through provider interfaces,
// runs the models, persists envelopes, and degrades explicitly (fallback flags / unavailable inputs) instead of guessing.
//   telemetry.getTelemetry(stationId, { metric, from, to }) -> { points:[{ts,value}], provenance? }
//   twin.getState(stationId, { asOf })                       -> TwinState (see agent4c-contracts.md)
import { HOUR, IntelligenceError, iso } from './common.js';
import { forecastDemand, forecastDemandAuto } from './forecast.js';
import { predictDepletion } from './logistics.js';
import { detectAnomalies } from './anomaly.js';
import { predictMaintenance } from './maintenance.js';
import { computeRisk } from './risk.js';
import { recommend } from './optimize.js';

const STATION_CHANNELS = ['demandKw', 'outdoorC', 'windMs', 'pressureHpa', 'commsLatencyMs', 'commsPacketLoss'];
const sevRank = { critical: 0, warning: 1 };

export function createIntelligenceService({ telemetry, twin, store = null, now = () => new Date().toISOString(), models = {} } = {}) {
  const forecastAuto = models.forecastAuto || forecastDemandAuto;

  async function series(stationId, metric, asOf, lookbackH) {
    try {
      const r = await telemetry.getTelemetry(stationId, { metric, from: iso(Date.parse(asOf) - lookbackH * HOUR), to: asOf });
      return { points: r?.points || [], provenance: r?.provenance ?? null };
    } catch (e) { throw new IntelligenceError('TELEMETRY_UNAVAILABLE', `Telemetry unavailable for ${metric}`, { cause: e.code || e.message }); }
  }
  const stamp = (env, stationId, asOf, generatedAt) => { const e = { ...env, stationId, generatedAt }; store?.save(e); return e; };
  const ctx = (o) => { const t = o?.asOf || now(); return { asOf: t, generatedAt: t }; };

  async function getForecast(stationId, { metric = 'demandKw', horizonH = 24, asOf } = {}) {
    const c = ctx({ asOf });
    if (metric === 'demandKw') {
      const d = await series(stationId, 'demandKw', c.asOf, 672 + 24);
      const hist = { demandKw: d.points, provenance: d.provenance };
      const [t, a] = await Promise.all([series(stationId, 'outdoorC', c.asOf, 696).catch(() => ({ points: [] })), series(stationId, 'activity', c.asOf, 696).catch(() => ({ points: [] }))]);
      hist.outdoorC = t.points; hist.activity = a.points;
      let f;
      try { f = forecastAuto(hist, { horizonH, asOf: c.asOf }); }
      catch (e) {
        if (e.code === 'INVALID_HORIZON') throw e;
        try { f = forecastDemand(hist, { horizonH, asOf: c.asOf, model: 'baseline' }); f.fallback = { used: true, reason: e.message, code: e.code || 'MODEL_ERROR', attempted: 'ridge-energy' }; }
        catch (e2) { throw e2; } // even the baseline cannot run: surface INSUFFICIENT_DATA rather than invent numbers
      }
      return stamp(f, stationId, c.asOf, c.generatedAt);
    }
    if (metric === 'outdoorC') {
      const s = await series(stationId, 'outdoorC', c.asOf, 696);
      const f = forecastDemand({ demandKw: s.points, provenance: s.provenance }, { horizonH, asOf: c.asOf, model: 'baseline' });
      return stamp({ ...f, metric: 'outdoorC', unit: '°C', assumptions: ['seasonal-naive persistence only; no meteorological model'] }, stationId, c.asOf, c.generatedAt);
    }
    if (metric === 'fuelL') {
      const l = await getLogistics(stationId, { asOf });
      if (l.status !== 'ok') throw new IntelligenceError('INSUFFICIENT_DATA', 'No measurable burn rate for fuel projection');
      const pts = Array.from({ length: horizonH }, (_, k) => ({ offsetH: k + 1, ts: iso(Date.parse(l.asOf) + (k + 1) * HOUR), value: Math.max(0, Math.round((l.levelL - l.burnLph * (k + 1)) * 100) / 100) }));
      return stamp({ kind: 'forecast', metric: 'fuelL', unit: 'L', horizonH, asOf: l.asOf, points: pts, model: l.model, inputWindow: l.inputWindow, confidence: l.confidence, uncertainty: { method: 'linear-burn', note: 'no interval; see getLogistics for depletion range' }, provenance: l.provenance, inputProvenance: l.inputProvenance, assumptions: ['constant burn rate'], fallback: null }, stationId, c.asOf, c.generatedAt);
    }
    throw new IntelligenceError('UNSUPPORTED_METRIC', `No forecast model for metric "${metric}"`);
  }

  async function getLogistics(stationId, { asOf } = {}) {
    const c = ctx({ asOf });
    const f = await series(stationId, 'fuelL', c.asOf, 24 * 14);
    let eta = null;
    try { const st = await twin?.getState(stationId, { asOf: c.asOf }); if (st?.logistics?.nextResupplyH !== undefined) eta = iso(Date.parse(c.asOf) + st.logistics.nextResupplyH * HOUR); } catch { /* resupply ETA unknown */ }
    return stamp(predictDepletion(f.points, { resupplyEtaTs: eta, provenance: f.provenance }), stationId, c.asOf, c.generatedAt);
  }

  async function getAnomaliesDetailed(stationId, { asOf, windowH = 24 } = {}) {
    const c = ctx({ asOf });
    let gens = [];
    try { gens = ((await twin?.getState(stationId, { asOf: c.asOf }))?.assets || []).filter((a) => a.type === 'generator').map((a) => a.id); } catch { /* station-level channels only */ }
    const targets = [...STATION_CHANNELS.map((ch) => ({ assetId: 'station', channel: ch, metric: ch })), ...gens.flatMap((g) => ['loading', 'exhaustTempC'].map((ch) => ({ assetId: g, channel: ch, metric: `${g}.${ch}` })))];
    const anomalies = [], skipped = [];
    for (const t of targets) {
      const s = await series(stationId, t.metric, c.asOf, 24 * 14);
      if (!s.points.length) { skipped.push({ assetId: t.assetId, channel: t.channel, reason: 'no_data' }); continue; }
      const r = detectAnomalies({ assetId: t.assetId, channel: t.channel, points: s.points, provenance: s.provenance });
      if (r.status !== 'ok') { skipped.push({ assetId: t.assetId, channel: t.channel, reason: r.reason }); continue; }
      anomalies.push(...r.anomalies.filter((a) => Date.parse(a.ts) > Date.parse(c.asOf) - windowH * HOUR));
    }
    anomalies.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Date.parse(b.ts) - Date.parse(a.ts));
    return stamp({ kind: 'anomalies', asOf: c.asOf, windowH, anomalies, skipped, model: anomalies[0]?.model ?? { name: 'robust-seasonal-zscore', version: '1.0.0' }, provenance: 'DERIVED' }, stationId, c.asOf, c.generatedAt);
  }
  const getAnomalies = async (id, o) => (await getAnomaliesDetailed(id, o)).anomalies;

  async function getMaintenanceDetailed(stationId, { asOf } = {}) {
    const c = ctx({ asOf });
    const st = await twin.getState(stationId, { asOf: c.asOf });
    const out = [];
    for (const a of (st.assets || []).filter((x) => ['generator', 'comms'].includes(x.type))) {
      const names = a.type === 'generator' ? ['loading', 'exhaustTempC', 'specificFuelLPerKwh'] : ['commsPacketLoss', 'commsLatencyMs'];
      const indicators = {};
      for (const n of names) { const s = await series(stationId, a.type === 'generator' ? `${a.id}.${n}` : n, c.asOf, 24 * 14); if (s.points.length) indicators[n] = s.points; }
      out.push(stamp(predictMaintenance({ assetId: a.id, assetType: a.type, indicators, provenance: 'SYNTHETIC' }, { asOf: c.asOf }), stationId, c.asOf, c.generatedAt));
    }
    return out;
  }
  const getMaintenance = async (id, o) => (await getMaintenanceDetailed(id, o)).filter((m) => m.status === 'ok').map((m) => ({ ...m, action: m.recommendedInspection }));

  async function gather(stationId, asOf) {
    const unavailable = [], out = {};
    const tryIt = async (k, fn) => { try { out[k] = await fn(); } catch (e) { unavailable.push({ input: k, code: e.code || 'ERROR', message: e.message }); out[k] = null; } };
    await tryIt('state', () => twin.getState(stationId, { asOf }));
    await tryIt('demandForecast', () => getForecast(stationId, { metric: 'demandKw', horizonH: 24, asOf }));
    await tryIt('anomalies', async () => (await getAnomaliesDetailed(stationId, { asOf })).anomalies);
    await tryIt('maintenance', () => getMaintenanceDetailed(stationId, { asOf }));
    await tryIt('logistics', () => getLogistics(stationId, { asOf }));
    return { ...out, unavailable };
  }

  async function getRisk(stationId, { asOf } = {}) {
    const c = ctx({ asOf }), g = await gather(stationId, c.asOf);
    const previous = store?.latest(stationId, 'risk') ?? null;
    const r = computeRisk({ state: g.state, demandForecast: g.demandForecast, anomalies: g.anomalies || [], maintenance: g.maintenance || [], logistics: g.logistics, previous, asOf: c.asOf });
    return stamp({ ...r, unavailableInputs: g.unavailable, inputWindow: g.demandForecast?.inputWindow ?? null }, stationId, c.asOf, c.generatedAt);
  }

  async function getRecommendations(stationId, { asOf } = {}) {
    const c = ctx({ asOf }), g = await gather(stationId, c.asOf);
    const risk = computeRisk({ state: g.state, demandForecast: g.demandForecast, anomalies: g.anomalies || [], maintenance: g.maintenance || [], logistics: g.logistics, asOf: c.asOf });
    const recs = recommend({ state: g.state, demandForecast: g.demandForecast, logistics: g.logistics, risk, maintenance: g.maintenance || [], asOf: c.asOf });
    return stamp({ kind: 'recommendations', asOf: c.asOf, recommendations: recs, riskScore: risk.score, unavailableInputs: g.unavailable, provenance: 'DERIVED', model: recs[0]?.model ?? { name: 'rule-optimizer', version: '1.0.0' } }, stationId, c.asOf, c.generatedAt);
  }

  return {
    getForecast, getLogistics, getAnomalies, getAnomaliesDetailed, getMaintenance, getMaintenanceDetailed,
    getRisk: async (id, o) => { const r = await getRisk(id, o); return r; }, getRecommendations,
  };
}
