// Agent 4B — resource/logistics prediction: burn rate, days of autonomy, depletion date, resupply risk, consumption.
import { HOUR, IntelligenceError, MODELS, PROVENANCE, clamp, iso, mean, resampleHourly, round, std } from './common.js';
const Z80 = 1.2816;

export function estimateBurnRate(fuelPts, { windowH = 168 } = {}) {
  const r = resampleHourly(fuelPts);
  const cons = [];
  for (let i = 1; i < r.values.length; i++) {
    if (r.values[i] === null || r.values[i - 1] === null) continue;
    const d = r.values[i - 1] - r.values[i];
    if (d >= 0) cons.push({ i, d }); // negative steps = refuel (or sensor noise) and are excluded, which slightly biases burn upward under noisy gauges
  }
  const recent = cons.filter((c) => c.i >= r.values.length - windowH).map((c) => c.d);
  if (recent.length < 24) throw new IntelligenceError('INSUFFICIENT_DATA', `Need >= 24 hourly fuel-consumption steps, have ${recent.length}`, { have: recent.length, need: 24 });
  let last = r.values.length - 1; while (last > 0 && r.values[last] === null) last--;
  return { burnLph: mean(recent), se: std(recent) / Math.sqrt(recent.length), n: recent.length, levelL: r.values[last], lastMs: r.start + last * HOUR, start: r.start, rawMissingFraction: r.rawMissingFraction };
}

export function predictDepletion(fuelPts, { resupplyEtaTs = null, safetyMarginH = 48, provenance = null } = {}) {
  const b = estimateBurnRate(fuelPts);
  const meta = { kind: 'logistics', asOf: iso(b.lastMs), model: MODELS.logistics, provenance: PROVENANCE.PREDICTED, inputProvenance: provenance,
    inputWindow: { from: iso(b.start), to: iso(b.lastMs), points: b.n, rawMissingFraction: round(b.rawMissingFraction, 4) } };
  if (b.burnLph <= 1e-6) return { ...meta, status: 'no_consumption', levelL: round(b.levelL), burnLph: 0, depletion: null, resupplyRisk: { level: 'unknown', reason: 'No measurable fuel consumption in the window' }, confidence: 0.3 };
  const sigmaEff = Math.max(b.se, 0.1 * b.burnLph); // 10% floor: SE alone ignores demand regime changes
  const central = b.levelL / b.burnLph, earliest = b.levelL / (b.burnLph + Z80 * sigmaEff), latest = b.levelL / Math.max(b.burnLph - Z80 * sigmaEff, 0.2 * b.burnLph);
  const at = (h) => iso(b.lastMs + h * HOUR);
  const depletion = { ts: at(central), earliestTs: at(earliest), latestTs: at(latest), level: 0.8 };
  let resupplyRisk = { level: 'unknown', reason: 'No resupply ETA supplied' };
  if (resupplyEtaTs) {
    const etaH = (Date.parse(resupplyEtaTs) - b.lastMs) / HOUR, mC = central - etaH, mE = earliest - etaH;
    const level = mC < 0 ? 'critical' : mE < 0 ? 'high' : mE < safetyMarginH ? 'moderate' : 'low';
    resupplyRisk = { level, marginHours: round(mC, 1), earliestMarginHours: round(mE, 1), safetyMarginH, etaTs: resupplyEtaTs,
      reason: `Fuel is expected to last ${round(central, 0)} h (as early as ${round(earliest, 0)} h); resupply arrives in ${round(etaH, 0)} h` };
  }
  return { ...meta, status: 'ok', levelL: round(b.levelL), burnLph: round(b.burnLph, 3), burnLphStdErr: round(sigmaEff, 3), daysOfAutonomy: round(central / 24, 2),
    depletion, resupplyRisk, confidence: round(clamp(1 - sigmaEff / b.burnLph, 0.1, 0.95) * (1 - b.rawMissingFraction), 3) };
}

/** Litres consumed over a demand forecast, using the station's measured litres-per-kWh (never an assumed constant). */
export function predictConsumption(demandForecast, fuelPts, demandPts) {
  const f = resampleHourly(fuelPts), d = resampleHourly(demandPts);
  let L = 0, kwh = 0;
  for (let i = 1; i < f.values.length; i++) {
    const j = Math.round((f.start - d.start) / HOUR) + i;
    const dv = j >= 0 ? d.values[j] : null;
    if (f.values[i] === null || f.values[i - 1] === null || dv === null || dv === undefined) continue;
    if (f.values[i - 1] <= 0) continue; // empty tank: consumption is supply-limited, not demand-driven
    const c = f.values[i - 1] - f.values[i]; if (c < 0) continue; L += c; kwh += dv;
  }
  if (kwh <= 0) throw new IntelligenceError('INSUFFICIENT_DATA', 'Cannot estimate litres per kWh from history');
  const lpk = L / kwh; let cum = 0, lo = 0, hi = 0;
  const points = demandForecast.points.map((p) => { cum += p.value * lpk; lo += p.lower * lpk; hi += p.upper * lpk; return { offsetH: p.offsetH, ts: p.ts, cumulativeL: round(cum), lowerL: round(lo), upperL: round(hi) }; });
  return { kind: 'consumption', litresPerKwh: round(lpk, 4), points, asOf: demandForecast.asOf, model: { name: 'forecast-x-specific-consumption', version: '1.0.0' }, provenance: PROVENANCE.PREDICTED, derivedFrom: { forecastModel: demandForecast.model } };
}

/** Depletion-date error (hours): train on fuel history up to `trainUntilTs`, compare with the realised depletion time. */
export function evaluateDepletion(fuelPts, trainUntilTs, trueDepletionTs) {
  const p = predictDepletion(fuelPts.filter((q) => Date.parse(q.ts) <= Date.parse(trainUntilTs)));
  const errH = (Date.parse(p.depletion.ts) - Date.parse(trueDepletionTs)) / HOUR;
  const inRange = Date.parse(trueDepletionTs) >= Date.parse(p.depletion.earliestTs) && Date.parse(trueDepletionTs) <= Date.parse(p.depletion.latestTs);
  return { errorHours: round(errH, 2), absErrorHours: round(Math.abs(errH), 2), relativeErrorPct: round(Math.abs(errH) / ((Date.parse(trueDepletionTs) - Date.parse(p.asOf)) / HOUR) * 100, 2), withinInterval: inRange, predicted: p.depletion };
}
