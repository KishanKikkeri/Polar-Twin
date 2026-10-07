// Agent 4B — seeded SYNTHETIC station data for tests/evaluation/dev. Every point is labelled SYNTHETIC.
// Metrics computed on this data say how the models behave on *this generator*, NOT on real Maitri/Bharati sensors.
import { HOUR, PROVENANCE, gaussian, iso, mulberry32 } from './common.js';

const START = Date.parse('2026-01-05T00:00:00.000Z'); // a Monday

export function generateSyntheticStation({ seed = 1, days = 28, refuel = null, injected = [], drift = {}, start = START } = {}) {
  const rng = mulberry32(seed), n = days * 24;
  const out = { start: iso(start), hours: n, provenance: PROVENANCE.SYNTHETIC, series: {}, labels: {} };
  const push = (k, i, v) => { (out.series[k] ||= []).push({ ts: iso(start + i * HOUR), value: v }); };
  let shift = 0, fuel = 12000, tempPrev = null;
  for (let i = 0; i < n; i++) {
    const h = i % 24, dow = Math.floor(i / 24) % 7;
    if (h === 0) shift = Math.max(-12, Math.min(8, shift + gaussian(rng) * 3));
    const temp = -10 + 5 * Math.sin((2 * Math.PI * (h - 15)) / 24) + shift + gaussian(rng) * 0.5;
    const act = (h >= 8 && h < 18 ? 1 : 0.2) * (dow >= 5 ? 0.5 : 1);
    let demand = 120 + 25 * Math.sin((2 * Math.PI * (h - 6)) / 24) + 2.0 * (5 - temp) + 30 * act + gaussian(rng) * 2.5;
    const loading0 = demand / 400;
    const wind = 8 + 3 * Math.sin((2 * Math.PI * h) / 24) + gaussian(rng) * 1.2;
    const vals = { demandKw: demand, outdoorC: temp, activity: act, windMs: wind, pressureHpa: 985 + gaussian(rng) * 1.5,
      'DG-1.loading': loading0 + (drift.loadingPerDay || 0) * (i / 24) + gaussian(rng) * 0.01,
      'DG-1.exhaustTempC': 380 + 60 * (loading0 - 0.5) + (drift.exhaustTempPerDay || 0) * (i / 24) + gaussian(rng) * 2,
      commsLatencyMs: 600 + gaussian(rng) * 25 };
    for (const inj of injected) if (inj.i === i) { vals[inj.channel] += inj.delta; (out.labels[inj.channel] ||= []).push(i); }
    if (refuel && i === refuel.i) fuel += refuel.litres;
    fuel -= 0.28 * vals.demandKw; vals.fuelL = Math.max(0, fuel);
    for (const [k, v] of Object.entries(vals)) push(k, i, v);
    tempPrev = temp;
  }
  return out;
}

/** Telemetry provider over synthetic data that honours `from`/`to` (so as_of-style callers never see the future). */
export function createSyntheticTelemetryProvider(data, { drop = [] } = {}) {
  return {
    async getTelemetry(stationId, { metric, from, to } = {}) {
      if (drop.includes(metric)) return { metric, points: [], provenance: PROVENANCE.SYNTHETIC };
      const s = data.series[metric] || [];
      const f = from ? Date.parse(from) : -Infinity, t = to ? Date.parse(to) : Infinity;
      return { metric, provenance: data.provenance, points: s.filter((p) => Date.parse(p.ts) >= f && Date.parse(p.ts) <= t) };
    },
  };
}
