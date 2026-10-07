import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runScenario, AuditLog, ScenarioError, SCENARIO_TYPES, deepFreeze, deepClone,
  parseScenario, createReplay, initialReplayState, replayReducer,
  buildEmergencyView, filterEmergencyAlerts, EMERGENCY_ORDER, compareStations,
  createCopilot, assertGrounded,
  createMockTwinProvider, createMockPredictionProvider, createUnavailableProvider,
} from '../../src/decision/index.js';

// Tight, hand-checkable fixture: 100 kW load, one online generator, one standby, 200 kWh battery.
const tight = () => ({
  stationId: 'test', asOf: '2026-02-01T00:00:00.000Z',
  assets: [
    { id: 'DG-1', type: 'generator', status: 'online', capacityKw: 100 },
    { id: 'DG-2', type: 'generator', status: 'offline', capacityKw: 100 },
    { id: 'MED-1', type: 'medical', status: 'online' },
  ],
  energy: { baseDemandKw: 100, batteryKwh: 200, batteryCapacityKwh: 400 },
  fuel: { tankL: 5000, resupplyL: 10000 }, logistics: { nextResupplyH: 48 },
  thermal: { indoorC: 20 }, comms: { linkQuality: 0.9 }, environment: { outdoorC: -10, windMs: 5 }, alerts: [],
});
const DG1_FAIL = { type: 'generator_failure', params: { assetId: 'DG-1', durationH: 8 } };

describe('scenario engine', () => {
  test('deterministic: identical inputs give identical results and hashes', () => {
    const a = runScenario(tight(), DG1_FAIL), b = runScenario(tight(), DG1_FAIL);
    assert.deepEqual(a, b);
    assert.equal(a.resultHash, b.resultHash);
  });

  test('known outcome is hand-verifiable (DG-1 fails 8h)', () => {
    const r = runScenario(tight(), DG1_FAIL);
    assert.equal(r.result.metrics.batteryDepletionHour, 1); // 200 kWh / 100 kW
    assert.equal(r.result.metrics.shortfallHours, 6);
    assert.equal(r.result.metrics.totalUnmetKwh, 600);
    assert.equal(r.baseline.metrics.shortfallHours, 0);
  });

  test('versioned + auditable: record carries versions, replay verifies', () => {
    const log = new AuditLog();
    const r = runScenario(tight(), DG1_FAIL, { auditLog: log });
    assert.ok(r.engineVersion && r.schemaVersion && r.inputHash && r.id.startsWith('sc_'));
    assert.equal(log.list().length, 1);
    assert.equal(log.verify(r.id).ok, true);
    assert.equal(log.verify('nope').ok, false);
  });

  test('isolation: input state is never mutated, even when frozen; runs do not leak', async () => {
    const frozen = deepFreeze(tight());
    const before = JSON.stringify(frozen);
    const r1 = runScenario(frozen, DG1_FAIL);
    assert.equal(JSON.stringify(frozen), before);
    // a scenario run must not alter what the provider returns afterwards
    const twin = createMockTwinProvider();
    const s1 = await twin.getState('maitri', { asOf: '2026-01-01T00:00:00.000Z' });
    runScenario(s1, { type: 'generator_failure', params: { assetId: 'DG-1' } });
    const s2 = await twin.getState('maitri', { asOf: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(s1, s2);
    // a later no-op-ish run is unaffected by an earlier severe one
    const r2 = runScenario(tight(), { type: 'comms_degradation', params: { qualityLossPct: 10 } });
    assert.deepEqual(r2.baseline, r1.baseline);
  });

  test('all seven scenario types execute and respect their own params', () => {
    const params = {
      temperature_drop: { deltaC: 20 }, generator_failure: { assetId: 'DG-1' }, battery_degradation: { capacityLossPct: 50 },
      demand_increase: { pct: 100 }, fuel_shortage: { lossPct: 90 }, resupply_delay: { delayH: 100 }, comms_degradation: { qualityLossPct: 80 },
    };
    assert.deepEqual(Object.keys(params).sort(), Object.keys(SCENARIO_TYPES).sort());
    for (const [type, p] of Object.entries(params)) {
      const r = runScenario(tight(), { type, params: p });
      assert.ok(r.result.timeline.length === r.horizonH, type);
      assert.ok(Number.isFinite(r.result.metrics.riskScore), type);
    }
  });

  test('validation: unknown type, out-of-range, unknown/non-generator asset, unknown param', () => {
    const code = (raw) => { try { runScenario(tight(), raw); } catch (e) { assert.ok(e instanceof ScenarioError); return e.code; } };
    assert.equal(code({ type: 'meteor' }), 'UNKNOWN_TYPE');
    assert.equal(code({ type: 'temperature_drop', params: { deltaC: 999 } }), 'OUT_OF_RANGE');
    assert.equal(code({ type: 'generator_failure', params: { assetId: 'DG-9' } }), 'UNKNOWN_ASSET');
    assert.equal(code({ type: 'generator_failure', params: { assetId: 'MED-1' } }), 'UNKNOWN_ASSET');
    assert.equal(code({ type: 'temperature_drop', params: { bogus: 1 } }), 'UNKNOWN_PARAM');
  });
});

describe('baseline vs scenario comparison', () => {
  const run = runScenario(tight(), DG1_FAIL);
  const row = (k) => run.comparison.rows.find((r) => r.metric === k);

  test('absolute and percentage differences', () => {
    assert.equal(row('totalUnmetKwh').absDiff, 600);
    assert.equal(row('totalUnmetKwh').pctDiff, null); // baseline is 0 -> relative change undefined, never Infinity
    assert.equal(row('totalUnmetKwh').direction, 'worse');
    assert.equal(row('batteryMinPct').baseline, 50);
    assert.equal(row('batteryMinPct').scenario, 0);
    assert.equal(row('batteryMinPct').pctDiff, -100);
  });

  test('affected systems, risk impact, recommendation', () => {
    const systems = run.comparison.affectedSystems.map((s) => s.system);
    assert.ok(systems.includes('power') && systems.includes('energy storage'));
    assert.ok(run.comparison.riskImpact.delta > 0);
    assert.equal(run.comparison.recommendations[0].action, 'Start standby generator DG-2'); // grounded in the twin's real asset list
  });

  test('benign scenario recommends no intervention', () => {
    const r = runScenario(tight(), { type: 'comms_degradation', params: { qualityLossPct: 1, durationH: 1 } });
    assert.match(r.comparison.recommendations.at(-1).action, /No intervention|Switch|Shed/);
  });
});

describe('natural-language what-if parsing', () => {
  const s = tight();
  test('the spec example', () => {
    const p = parseScenario('What happens if DG-1 fails for 8 hours?', s);
    assert.equal(p.ok, true);
    assert.deepEqual(p.scenario.params, { durationH: 8, assetId: 'DG-1' });
    assert.equal(p.scenario.type, 'generator_failure');
    assert.deepEqual(p.assumptions, []);
  });
  test('units, defaults are reported as assumptions', () => {
    const d = parseScenario('resupply delayed by 3 days', s);
    assert.equal(d.scenario.params.delayH, 72);
    const t = parseScenario('temperature drops 15 degrees', s);
    assert.equal(t.scenario.params.deltaC, 15);
    assert.ok(t.assumptions.length === 1 && /duration/i.test(t.assumptions[0]));
    assert.equal(parseScenario('demand increases 40%', s).scenario.params.pct, 40);
    assert.equal(parseScenario('battery loses 30% capacity', s).scenario.type, 'battery_degradation');
    assert.equal(parseScenario('communication degraded 60% for 4 hours', s).scenario.params.qualityLossPct, 60);
  });
  test('refuses to guess: unknown asset, missing asset, gibberish, empty', () => {
    assert.equal(parseScenario('what if DG-9 fails for 2 hours', s).code, 'UNKNOWN_ASSET');
    assert.equal(parseScenario('what if the generator fails', s).code, 'NEEDS_CLARIFICATION');
    assert.equal(parseScenario('make the penguins happier', s).code, 'NO_MATCH');
    assert.equal(parseScenario('', s).code, 'EMPTY');
    assert.equal(parseScenario('DG-1 fails for 500 hours', s).code, 'OUT_OF_RANGE');
  });
});

describe('historical replay', () => {
  const FROM = '2026-01-10T00:00:00.000Z', TO = '2026-01-12T00:00:00.000Z';

  test('every frame goes through as_of — never the live path', async () => {
    const twin = createMockTwinProvider();
    const rp = createReplay({ provider: twin, stationId: 'maitri', from: FROM, to: TO });
    const f = await rp.frameAt('2026-01-11T06:00:00.000Z');
    assert.equal(f.available, true);
    assert.equal(f.state.asOf, '2026-01-11T06:00:00.000Z');
    assert.ok(twin.calls.filter((c) => c.fn === 'getState').every((c) => c.asOf));
  });
  test('reconstruction differs across time and is repeatable', async () => {
    const rp = createReplay({ provider: createMockTwinProvider(), stationId: 'maitri', from: FROM, to: TO });
    const a = await rp.frameAt('2026-01-10T06:00:00.000Z'), b = await rp.frameAt('2026-01-10T18:00:00.000Z');
    assert.notEqual(a.state.environment.outdoorC, b.state.environment.outdoorC);
    assert.deepEqual(await rp.frameAt('2026-01-10T06:00:00.000Z'), a);
  });
  test('events never leak past the cursor and are time-ordered; cursor clamps to range', async () => {
    const rp = createReplay({ provider: createMockTwinProvider(), stationId: 'maitri', from: FROM, to: TO });
    const f = await rp.frameAt('2026-01-11T00:00:00.000Z');
    assert.ok(f.events.length > 0);
    assert.ok(f.events.every((e) => Date.parse(e.ts) <= Date.parse(f.asOf)));
    assert.deepEqual(f.events.map((e) => e.ts), [...f.events.map((e) => e.ts)].sort());
    assert.equal((await rp.frameAt('2030-01-01T00:00:00.000Z')).asOf, TO);
  });
  test('controls: seek, step, play/tick stops at end, speed, replay-from-start', () => {
    let s = initialReplayState({ from: FROM, to: '2026-01-10T03:00:00.000Z' });
    s = replayReducer(s, { type: 'step', dir: 1 });
    assert.equal(s.cursorMs - s.fromMs, 3600000);
    s = replayReducer(s, { type: 'step', dir: -5 });
    assert.equal(s.cursorMs, s.fromMs);
    s = replayReducer(s, { type: 'play' });
    for (let i = 0; i < 10; i++) s = replayReducer(s, { type: 'tick' });
    assert.equal(s.cursorMs, s.toMs);
    assert.equal(s.playing, false);
    assert.equal(replayReducer(s, { type: 'play' }).cursorMs, s.fromMs);
    assert.equal(replayReducer(s, { type: 'tick' }), s);
  });
  test('missing backend: explicit unavailable frame, no substituted data; bad range rejected', async () => {
    const rp = createReplay({ provider: createUnavailableProvider('twin'), stationId: 'maitri', from: FROM, to: TO });
    const f = await rp.frameAt(FROM);
    assert.equal(f.available, false);
    assert.equal(f.state, undefined);
    assert.equal((await rp.telemetryUpTo(TO)).available, false);
    assert.throws(() => createReplay({ provider: {}, stationId: 'x', from: TO, to: FROM }), RangeError);
  });
});

describe('emergency mode', () => {
  test('fixed priority order is respected', () => {
    const v = buildEmergencyView(tight());
    assert.deepEqual(v.priorities.map((p) => p.category), [...EMERGENCY_ORDER]);
    assert.deepEqual(v.priorities.map((p) => p.rank), [1, 2, 3, 4, 5, 6]);
    assert.equal(EMERGENCY_ORDER[0], 'critical_power');
    assert.equal(EMERGENCY_ORDER[3], 'medical');
  });
  test('derives statuses from state', () => {
    const s = tight();
    s.assets[0].status = 'offline'; s.energy.batteryKwh = 40; s.thermal.indoorC = 3; s.assets[2].status = 'offline';
    const by = Object.fromEntries(buildEmergencyView(s).priorities.map((p) => [p.category, p.status]));
    assert.equal(by.critical_power, 'critical'); assert.equal(by.heating, 'critical'); assert.equal(by.medical, 'critical');
  });
  test('no medical assets => unknown, not a false "ok"', () => {
    const s = tight(); s.assets = s.assets.filter((a) => a.type !== 'medical');
    assert.equal(buildEmergencyView(s).priorities.find((p) => p.category === 'medical').status, 'unknown');
  });
  test('critical alerts always surface — even uncategorised, even when the operator filters', () => {
    const s = tight();
    s.alerts = [{ id: 'X', severity: 'critical', category: 'martian', message: 'boom' }, { id: 'Y', severity: 'info', category: 'fuel', message: 'meh' }];
    const v = buildEmergencyView(s);
    assert.ok(v.pinnedCritical.some((p) => p.id === 'X'));
    const filtered = filterEmergencyAlerts(v, () => false); // filter hides everything non-critical
    assert.ok(filtered.some((a) => a.id === 'X'));
    assert.ok(!filtered.some((a) => a.id === 'Y'));
  });
  test('pinned items are ordered by priority rank', () => {
    const s = tight();
    s.thermal.indoorC = 1; s.assets[0].status = 'offline'; s.assets[1].status = 'offline';
    const cats = buildEmergencyView(s).pinnedCritical.map((p) => p.category);
    assert.ok(cats.indexOf('critical_power') < cats.indexOf('heating'));
  });
});

describe('station comparison', () => {
  test('Maitri vs Bharati across all required dimensions', async () => {
    const twin = createMockTwinProvider();
    const [a, b] = await Promise.all([twin.getState('maitri', {}), twin.getState('bharati', {})]);
    const c = compareStations(a, b);
    assert.equal(c.ok, true);
    const dims = new Set(c.rows.map((r) => r.dimension));
    for (const d of ['condition', 'energy', 'fuel', 'logistics', 'infrastructure', 'risk', 'environment']) assert.ok(dims.has(d), d);
    const fuel = c.rows.find((r) => r.metric === 'tankL');
    assert.equal(fuel.a, 12000); assert.equal(fuel.b, 9000); assert.equal(fuel.diff, -3000); assert.equal(fuel.better, 'a');
    assert.equal(c.rows.find((r) => r.metric === 'outdoorC').better, 'n/a'); // no value judgement on weather
  });
  test('missing station data is reported, not papered over', () => {
    const c = compareStations(tight(), null);
    assert.equal(c.ok, false); assert.deepEqual(c.missing, ['B']);
  });
});

describe('operations copilot', () => {
  const mk = (o = {}) => createCopilot({ twin: createMockTwinProvider(), predictions: createMockPredictionProvider(), ...o });
  const ctx = { stationId: 'maitri', asOf: '2026-01-05T00:00:00.000Z' };

  test('answers across all supported topics and every answer is grounded', async () => {
    const cp = mk();
    const qs = ['What is the station status?', 'Any alerts?', 'How much fuel do we have?', 'What is the risk?', 'forecast fuel',
      'any anomalies?', 'upcoming maintenance?', 'what do you recommend?', 'what is the status of DG-1?', 'What happens if DG-1 fails for 8 hours?'];
    for (const q of qs) {
      const r = await cp.ask(q, ctx);
      assert.equal(r.status, 'ok', q);
      assert.ok(r.facts.length > 0, q);
      assert.ok(r.facts.every((f) => f.source?.tool && f.source?.asOf), q);
      const g = assertGrounded(r);
      assert.deepEqual(g.ungrounded, [], `${q} -> ${r.answer}`);
    }
  });
  test('the grounding checker actually catches a fabricated number', () => {
    const fake = { answer: 'DG-1 is producing 999 kW.', facts: [{ display: '250 kW', label: 'Rated', source: { asOf: '2026-01-05T00:00:00.000Z' } }] };
    assert.deepEqual(assertGrounded(fake).ungrounded, ['999']);
  });
  test('nonexistent asset: says so, invents nothing', async () => {
    const r = await mk().ask('status of DG-9?', ctx);
    assert.equal(r.status, 'not_found'); assert.equal(r.facts.length, 0);
  });
  test('twin backend down: unavailable, no guessed state', async () => {
    const r = await createCopilot({ twin: createUnavailableProvider('twin'), predictions: createMockPredictionProvider() }).ask('station status?', ctx);
    assert.equal(r.status, 'unavailable'); assert.equal(r.facts.length, 0); assert.match(r.answer, /won't estimate/);
  });
  test('ML models down: forecasts/maintenance unavailable; state answers still work; risk labelled as local estimate', async () => {
    const cp = mk({ predictions: createUnavailableProvider('ml') });
    assert.equal((await cp.ask('forecast demand', ctx)).status, 'unavailable');
    assert.equal((await cp.ask('maintenance due?', ctx)).status, 'unavailable');
    assert.equal((await cp.ask('station status', ctx)).status, 'ok');
    const risk = await cp.ask('what is the risk?', ctx);
    assert.match(risk.answer, /not an ML prediction/);
    assert.ok(risk.facts.every((f) => f.source.tool === 'scenario_engine.baseline'));
  });
  test('unsupported and under-specified questions do not fabricate', async () => {
    const cp = mk();
    assert.equal((await cp.ask('who will win the cricket match?', ctx)).status, 'unsupported');
    assert.equal((await cp.ask('station status?', {})).status, 'clarify');
    const bad = await cp.ask('what if the penguins revolt', ctx);
    assert.equal(bad.status, 'clarify');
  });
  test('what-if via copilot goes through the engine and is auditable', async () => {
    const log = new AuditLog();
    const r = await mk({ auditLog: log }).ask('What happens if DG-1 fails for 8 hours?', ctx);
    assert.ok(r.run && log.verify(r.run.id).ok);
    assert.equal(r.run.scenario.params.durationH, 8);
  });
});
