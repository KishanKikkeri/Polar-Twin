// Agent 4C — natural-language -> structured scenario.
// Deterministic rule-based parser (no LLM). It only EXTRACTS parameters; the scenario
// engine validates and executes. Anything unparseable returns an explicit failure,
// never a guessed scenario. Every defaulted value is reported in `assumptions`.

import { SCENARIO_TYPES } from './core.js';
import { normalizeScenario, ScenarioError } from './scenarioEngine.js';

const SUPPORTED = Object.keys(SCENARIO_TYPES);
const fail = (code, message) => ({ ok: false, code, message, supported: SUPPORTED });

function duration(text) {
  const m = text.match(/(?:for|over|during|lasting|by)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|days?|d)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /^d/.test(m[2]) ? n * 24 : n;
}
const percent = (text) => { const m = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/); return m ? parseFloat(m[1]) : null; };

export function parseScenario(input, state) {
  if (typeof input !== 'string' || !input.trim()) return fail('EMPTY', 'No scenario text provided');
  const text = input.toLowerCase();
  const assumptions = [];
  let type = null;
  const params = {};

  const take = (key, value, fallbackNote) => {
    if (value === null || value === undefined) { assumptions.push(fallbackNote); return; }
    params[key] = value;
  };

  const assetMatch = input.match(/\b([A-Za-z]{2,4}-\d+)\b/);
  const failureWords = /(fail|failure|trip|goes? down|go(?:es)? offline|breaks?|outage|lost)/;

  if (assetMatch && /^(dg|gen)/i.test(assetMatch[1]) && failureWords.test(text)) {
    type = 'generator_failure';
    params.assetId = assetMatch[1].toUpperCase();
    take('durationH', duration(text), `No duration given; assumed ${SCENARIO_TYPES[type].params.durationH.default} h`);
  } else if (/resupply|re-supply/.test(text) && /(delay|late|postpone)/.test(text)) {
    type = 'resupply_delay';
    take('delayH', duration(text), `No delay length given; assumed ${SCENARIO_TYPES[type].params.delayH.default} h`);
  } else if (/fuel|diesel/.test(text) && /(shortage|short|loss|lost|reduc|leak|contaminat)/.test(text)) {
    type = 'fuel_shortage';
    take('lossPct', percent(text), `No percentage given; assumed ${SCENARIO_TYPES[type].params.lossPct.default}%`);
  } else if (/batter/.test(text) && /(degrad|capacity|loss|lose|fade|wear)/.test(text)) {
    type = 'battery_degradation';
    take('capacityLossPct', percent(text), `No percentage given; assumed ${SCENARIO_TYPES[type].params.capacityLossPct.default}%`);
  } else if (/(temperature|temp\b|cold|freez)/.test(text) && /(drop|fall|plunge|colder|decrease)/.test(text)) {
    type = 'temperature_drop';
    const d = text.match(/(\d+(?:\.\d+)?)\s*(?:°|degrees?|deg\b|c\b)/);
    take('deltaC', d ? parseFloat(d[1]) : null, `No magnitude given; assumed ${SCENARIO_TYPES[type].params.deltaC.default} °C drop`);
    take('durationH', duration(text), `No duration given; assumed ${SCENARIO_TYPES[type].params.durationH.default} h`);
  } else if (/(comm|satcom|link|network)/.test(text) && /(degrad|loss|down|poor|slow|drop|fail)/.test(text)) {
    type = 'comms_degradation';
    take('qualityLossPct', percent(text), `No percentage given; assumed ${SCENARIO_TYPES[type].params.qualityLossPct.default}%`);
    take('durationH', duration(text), `No duration given; assumed ${SCENARIO_TYPES[type].params.durationH.default} h`);
  } else if (/(demand|load)/.test(text) && /(increase|rise|spike|surge|up|higher)/.test(text)) {
    type = 'demand_increase';
    take('pct', percent(text), `No percentage given; assumed ${SCENARIO_TYPES[type].params.pct.default}%`);
    take('durationH', duration(text), `No duration given; assumed ${SCENARIO_TYPES[type].params.durationH.default} h`);
  } else if (/generator/.test(text) && failureWords.test(text)) {
    return fail('NEEDS_CLARIFICATION', 'Which generator? Please name an asset such as DG-1.');
  } else {
    return fail('NO_MATCH', 'Could not map this to a supported scenario type');
  }

  const raw = { type, params };
  if (!state) return { ok: true, scenario: raw, assumptions, parser: 'rules-v1' };
  try {
    return { ok: true, scenario: normalizeScenario(raw, state), assumptions, parser: 'rules-v1' };
  } catch (e) {
    if (e instanceof ScenarioError) return fail(e.code, e.message);
    throw e;
  }
}
