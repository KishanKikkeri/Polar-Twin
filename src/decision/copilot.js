// Agent 4C — Operations Copilot (grounded).
//
// Architecture: question -> intent router -> tool call(s) against platform providers
//   -> structured `facts` (each carries its source tool + asOf) -> text rendered ONLY
//   from facts. There is no free-form generation step, so operational state cannot be
//   invented. If a tool is unavailable the answer says so instead of guessing.
// `assertGrounded` re-checks that every number in the answer text exists in a fact.

import { batteryPct, fuelAutonomyH, onlineCapacityKw, round } from './core.js';
import { baselineMetrics, runScenario } from './scenarioEngine.js';
import { parseScenario } from './nlScenario.js';

export const CAPABILITIES = ['station state', 'asset state', 'current alerts', 'risk', 'fuel', 'predictions/forecasts', 'maintenance', 'recommendations', 'what-if scenarios'];

const fact = (key, label, value, unit, source) => ({ key, label, value, unit: unit || '', display: `${value}${unit ? ' ' + unit : ''}`, source });
const num = /(?<![\w.-])-?\d+(?:\.\d+)?/g;

export function assertGrounded(response) {
  const allowed = new Set();
  for (const f of response.facts) {
    String(f.display).match(num)?.forEach((n) => allowed.add(n));
    String(f.label).match(num)?.forEach((n) => allowed.add(n));
    if (f.source?.asOf) String(f.source.asOf).match(num)?.forEach((n) => allowed.add(n));
  }
  const bad = (response.answer.match(num) || []).filter((n) => !allowed.has(n));
  return { grounded: bad.length === 0, ungrounded: bad };
}

export function createCopilot({ twin, predictions, auditLog } = {}) {
  const unavailable = (what, why) => ({ status: 'unavailable', answer: `I can't answer that: ${what} is unavailable${why ? ` (${why})` : ''}. I won't estimate it.`, facts: [], sources: [] });
  const done = (answer, facts, extra = {}) => ({ status: 'ok', answer, facts, sources: [...new Set(facts.map((f) => f.source.tool))], ...extra });

  async function safe(fn) { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e }; } }

  async function ask(question, { stationId, asOf } = {}) {
    if (!stationId) return { status: 'clarify', answer: 'Which station (maitri or bharati)?', facts: [], sources: [] };
    const q = String(question || '').toLowerCase();
    const st = await safe(() => twin.getState(stationId, { asOf }));
    if (!st.ok) return unavailable('the twin state', st.error.code || st.error.message);
    const state = st.value;
    const src = (tool) => ({ tool, asOf: state.asOf });
    const stn = state.stationId;

    // --- what-if (NL -> scenario -> engine -> explanation)
    if (/(what happens|what if|what would|simulate|if .*\b(fail|drop|delay|increase|lose|shortage))/.test(q)) {
      const parsed = parseScenario(question, state);
      if (!parsed.ok) return { status: 'clarify', answer: `I couldn't turn that into a scenario: ${parsed.message}`, facts: [], sources: [], supported: parsed.supported };
      const run = runScenario(state, parsed.scenario, { auditLog });
      const r = run.comparison.riskImpact, m = run.result.metrics;
      const top = run.comparison.recommendations[0];
      const facts = [
        fact('scenario', 'Scenario', run.scenario.type, '', src('scenario_engine')),
        fact('hoursShort', 'Hours with unmet load', m.shortfallHours, 'h', src('scenario_engine')),
        fact('riskBase', 'Baseline risk', r.baseline.score, '', src('scenario_engine')),
        fact('riskScen', 'Scenario risk', r.scenario.score, '', src('scenario_engine')),
        fact('runId', 'Run', run.id, '', src('scenario_engine')),
      ];
      const assumed = parsed.assumptions.length ? ` Assumptions: ${parsed.assumptions.join('; ')}.` : '';
      return done(`${stn}: scenario ${run.scenario.type} causes ${m.shortfallHours} h of unmet load. Risk moves from ${r.baseline.score} (${r.baseline.level}) to ${r.scenario.score} (${r.scenario.level}). Top action: ${top.action}.${assumed} Run ${run.id}.`, facts, { run });
    }

    // --- asset state (only if the asset exists in the twin)
    const idMatch = question.match(/\b([A-Za-z]{2,4}-\d+)\b/);
    if (idMatch) {
      const asset = (state.assets || []).find((a) => a.id.toLowerCase() === idMatch[1].toLowerCase());
      if (!asset) return { status: 'not_found', answer: `No asset "${idMatch[1].toUpperCase()}" exists at ${stn}.`, facts: [], sources: ['twin'] };
      const facts = [fact('status', `${asset.id} status`, asset.status, '', src('twin')), fact('type', `${asset.id} type`, asset.type, '', src('twin'))];
      if (asset.capacityKw) facts.push(fact('cap', 'Rated capacity', asset.capacityKw, 'kW', src('twin')));
      return done(`${asset.id} (${asset.type}) at ${stn} is ${asset.status}${asset.capacityKw ? `, rated ${asset.capacityKw} kW` : ''}.`, facts);
    }

    if (/alert|warning|critical/.test(q)) {
      const al = state.alerts || [];
      if (!al.length) return done(`No active alerts at ${stn}.`, [fact('alertCount', 'Active alerts', 0, '', src('twin'))]);
      const facts = [fact('alertCount', 'Active alerts', al.length, '', src('twin')), ...al.map((a) => fact(a.id, a.severity, a.message, '', src('twin')))];
      return done(`${stn} has ${al.length} active alert(s): ${al.map((a) => `[${a.severity}] ${a.message}`).join('; ')}.`, facts);
    }

    if (/fuel|diesel/.test(q)) {
      const facts = [fact('tank', 'Fuel on hand', state.fuel.tankL, 'L', src('twin')), fact('aut', 'Autonomy at current demand', round(fuelAutonomyH(state), 0), 'h', src('twin')), fact('resupply', 'Next resupply in', state.logistics.nextResupplyH, 'h', src('twin'))];
      return done(`${stn} holds ${facts[0].display} of fuel, about ${facts[1].display} at current demand. Next resupply in ${facts[2].display}.`, facts);
    }

    if (/risk/.test(q)) {
      const r = await safe(() => predictions.getRisk(stationId, { asOf }));
      if (r.ok) {
        const facts = [fact('risk', 'Risk score', r.value.score, '', { tool: 'predictions.getRisk', asOf: state.asOf, model: r.value.model }), fact('level', 'Risk level', r.value.level, '', { tool: 'predictions.getRisk', asOf: state.asOf })];
        return done(`Risk at ${stn} is ${r.value.level} (score ${r.value.score}).${r.value.drivers?.length ? ` Drivers: ${r.value.drivers.join(', ')}.` : ''}`, facts);
      }
      const b = baselineMetrics(state);
      return done(`Prediction service unavailable. Local baseline estimate for ${stn}: risk ${b.riskLevel} (score ${b.riskScore}). This is a simulation estimate, not an ML prediction.`,
        [fact('risk', 'Risk score (local estimate)', b.riskScore, '', { tool: 'scenario_engine.baseline', asOf: state.asOf }), fact('level', 'Risk level', b.riskLevel, '', { tool: 'scenario_engine.baseline', asOf: state.asOf })]);
    }

    if (/predict|forecast|expect|anomal/.test(q)) {
      if (/anomal/.test(q)) {
        const a = await safe(() => predictions.getAnomalies(stationId, { asOf }));
        if (!a.ok) return unavailable('the anomaly service', a.error.code);
        if (!a.value.length) return done(`No anomalies reported for ${stn}.`, [fact('n', 'Anomalies', 0, '', { tool: 'predictions.getAnomalies', asOf: state.asOf })]);
        const facts = a.value.map((x) => fact(`${x.assetId}-${x.metric}`, `${x.assetId} ${x.metric}`, `${x.severity} (score ${x.score})`, '', { tool: 'predictions.getAnomalies', asOf: state.asOf, model: x.model }));
        return done(`Anomalies at ${stn}: ${facts.map((f) => `${f.label} ${f.display}`).join('; ')}.`, facts);
      }
      const metric = /fuel/.test(q) ? 'fuelL' : /batter/.test(q) ? 'batteryKwh' : /temp/.test(q) ? 'outdoorC' : 'demandKw';
      const f = await safe(() => predictions.getForecast(stationId, { metric, horizonH: 24, asOf }));
      if (!f.ok) return unavailable('the forecasting model', f.error.code);
      const pts = f.value.points, first = pts[0], last = pts[pts.length - 1];
      const s = { tool: 'predictions.getForecast', asOf: state.asOf, model: f.value.model };
      const facts = [fact('from', `${metric} at +${first.offsetH}h`, first.value, '', s), fact('to', `${metric} at +${last.offsetH}h`, last.value, '', s), fact('model', 'Model', `${f.value.model.name} ${f.value.model.version}`, '', s)];
      return done(`Forecast for ${metric} at ${stn}: ${first.value} at +${first.offsetH}h, ${last.value} at +${last.offsetH}h (model ${facts[2].display}).`, facts);
    }

    if (/maintenance|service|repair/.test(q)) {
      const m = await safe(() => predictions.getMaintenance(stationId, { asOf }));
      if (!m.ok) return unavailable('the maintenance model', m.error.code);
      if (!m.value.length) return done(`No maintenance items predicted for ${stn}.`, [fact('n', 'Items', 0, '', { tool: 'predictions.getMaintenance', asOf: state.asOf })]);
      const facts = m.value.map((x) => fact(x.assetId, `${x.assetId}: ${x.action}`, `due in ${x.dueInDays} d, failure risk index ${x.failureRisk30d ?? x.failureProbability}`, '', { tool: 'predictions.getMaintenance', asOf: state.asOf, model: x.model }));
      return done(`Maintenance at ${stn}: ${facts.map((f) => `${f.label} (${f.display})`).join('; ')}.`, facts);
    }

    if (/recommend|should (we|i)|advice|action/.test(q)) {
      const b = baselineMetrics(state);
      const facts = [fact('risk', 'Baseline risk', b.riskScore, '', { tool: 'scenario_engine.baseline', asOf: state.asOf })];
      const crit = (state.alerts || []).filter((a) => a.severity === 'critical');
      if (crit.length) return done(`Address critical alert first: ${crit[0].message}. Baseline risk is ${b.riskScore} (${b.riskLevel}).`, [...facts, fact('alert', 'Critical alert', crit[0].message, '', src('twin'))]);
      return done(`No critical alerts at ${stn}; baseline risk is ${b.riskScore} (${b.riskLevel}). Continue monitoring and use what-if scenarios to test contingencies.`, facts);
    }

    if (/status|state|overview|how is|condition/.test(q)) {
      const online = (state.assets || []).filter((a) => a.status === 'online').length;
      const facts = [
        fact('assets', 'Assets online', `${online} of ${(state.assets || []).length}`, '', src('twin')),
        fact('cap', 'Online generation', round(onlineCapacityKw(state), 0), 'kW', src('twin')),
        fact('demand', 'Demand', state.energy.baseDemandKw, 'kW', src('twin')),
        fact('batt', 'Battery', round(batteryPct(state), 0), '%', src('twin')),
        fact('indoor', 'Indoor temperature', state.thermal.indoorC, '°C', src('twin')),
      ];
      return done(`${stn}: ${facts[0].display} assets online; generation ${facts[1].display} vs demand ${facts[2].display}; battery ${facts[3].display}; indoor ${facts[4].display}.`, facts);
    }

    return { status: 'unsupported', answer: `I can only answer from platform data. Try asking about: ${CAPABILITIES.join(', ')}.`, facts: [], sources: [] };
  }
  return { ask };
}
