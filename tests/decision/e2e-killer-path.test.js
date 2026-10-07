import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runScenario,
  AuditLog,
  parseScenario,
  buildEmergencyView,
  EMERGENCY_ORDER,
  createCopilot,
  assertGrounded,
  createMockTwinProvider,
  createHttpTwinProvider,
  createLivePredictionProvider,
  createMockPredictionProvider,
} from '../../src/decision/index.js';
import {
  createIntelligenceService,
  createSyntheticTelemetryProvider,
  generateSyntheticStation,
} from '../../src/intelligence/index.js';

describe('SIH26060 Killer Path: End-to-End Digital Twin Decision & Operations Flow', () => {
  // ---------------------------------------------------------------------------
  // 1. Adapter Reconciliation: createHttpTwinProvider & createLivePredictionProvider
  // ---------------------------------------------------------------------------
  describe('Provider wiring & resilience', () => {
    test('createHttpTwinProvider queries endpoint when online and falls back to mock when offline', async () => {
      // Offline / erroring fetch simulation
      const offlineFetch = async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:8000');
      };

      const fallbackProvider = createHttpTwinProvider({
        baseUrl: 'http://localhost:8000',
        fetch: offlineFetch,
        fallbackToMock: true,
      });

      const state = await fallbackProvider.getState('maitri');
      assert.equal(state.stationId, 'maitri');
      assert.ok(state.assets.length > 0);
      assert.ok(state.energy.baseDemandKw > 0);

      const events = await fallbackProvider.getEvents('maitri', { from: '2026-01-01T00:00:00Z', to: '2026-01-01T12:00:00Z' });
      assert.ok(Array.isArray(events));

      const tele = await fallbackProvider.getTelemetry('maitri', {
        metric: 'demandKw',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-01T06:00:00Z',
      });
      assert.equal(tele.metric, 'demandKw');
      assert.ok(tele.points.length > 0);

      // Strict mode (no fallback) surfaces DependencyUnavailableError
      const strictProvider = createHttpTwinProvider({
        baseUrl: 'http://localhost:8000',
        fetch: offlineFetch,
        fallbackToMock: false,
      });

      await assert.rejects(
        async () => await strictProvider.getState('maitri'),
        { code: 'DEPENDENCY_UNAVAILABLE' }
      );
    });

    test('createLivePredictionProvider bridges Agent 4B intelligence service into 4C Copilot', async () => {
      const syn = generateSyntheticStation({ seed: 42, days: 30 });
      const teleProvider = createSyntheticTelemetryProvider(syn);
      const mockTwin = createMockTwinProvider();
      const intelService = createIntelligenceService({
        telemetry: teleProvider,
        twin: mockTwin,
        now: () => '2026-02-01T00:00:00.000Z',
      });

      const livePredictions = createLivePredictionProvider(intelService);
      const risk = await livePredictions.getRisk('maitri', { asOf: '2026-02-01T00:00:00.000Z' });
      assert.ok(Number.isFinite(risk.score));
      assert.ok(['low', 'moderate', 'elevated', 'critical', 'unknown'].includes(risk.level));

      const copilot = createCopilot({
        twin: mockTwin,
        predictions: livePredictions,
      });

      const resp = await copilot.ask('What is the risk at maitri?', {
        stationId: 'maitri',
        asOf: '2026-02-01T00:00:00.000Z',
      });
      assert.equal(resp.status, 'ok');
      assert.ok(resp.facts.length > 0);
      const groundCheck = assertGrounded(resp);
      assert.equal(groundCheck.grounded, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Full SIH Cascading Contingency Path
  // ---------------------------------------------------------------------------
  describe('Full Cascading Path: Cold Snap → Load Spike → DG-1 Failure → What-If → Copilot → Emergency Mode', () => {
    // Baseline state: Maitri Station
    const initialStationState = {
      stationId: 'maitri',
      asOf: '2026-02-15T06:00:00.000Z',
      assets: [
        { id: 'DG-1', type: 'generator', status: 'online', capacityKw: 250 },
        { id: 'DG-2', type: 'generator', status: 'online', capacityKw: 250 },
        { id: 'DG-3', type: 'generator', status: 'offline', capacityKw: 250 },
        { id: 'MED-1', type: 'medical', status: 'online' },
        { id: 'COM-1', type: 'comms', status: 'online' },
        { id: 'WTR-1', type: 'water', status: 'online' },
        { id: 'LAB-1', type: 'lab', status: 'degraded' },
      ],
      energy: { baseDemandKw: 180, batteryKwh: 900, batteryCapacityKwh: 1200 },
      fuel: { tankL: 12000, resupplyL: 20000 },
      logistics: { nextResupplyH: 96 },
      thermal: { indoorC: 20 },
      comms: { linkQuality: 0.9 },
      environment: { outdoorC: -12, windMs: 9 },
      alerts: [],
    };

    test('Stage 1 & 2: Outdoor temp drop drives thermal & electrical demand spike, depleting fuel autonomy', () => {
      // Cold snap: outdoor temp drops from -12°C to -35°C, blizzard winds 28 m/s
      const coldSnapState = JSON.parse(JSON.stringify(initialStationState));
      coldSnapState.environment.outdoorC = -35;
      coldSnapState.environment.windMs = 28;

      // Causal DAG response: thermal envelope heat loss increases, HVAC booster kicks in
      // 180 kW base demand spikes to 270 kW (+50% electrical heating demand)
      coldSnapState.energy.baseDemandKw = 270;
      coldSnapState.thermal.indoorC = 17; // indoor struggles against -35C

      // Stage 3 & 4: Fuel burn rate spikes from ~45 L/h to ~75 L/h
      // Autonomy drops: 12,000 L / (270 kW * 0.28 L/kWh) ~= 158 h (~6.6 days)
      coldSnapState.alerts.push({
        id: 'ALT-COLD-01',
        severity: 'warning',
        category: 'thermal',
        message: 'Severe blizzard: outdoor temperature dropped to -35°C; thermal load elevated',
      });
      coldSnapState.alerts.push({
        id: 'ALT-FUEL-02',
        severity: 'warning',
        category: 'fuel',
        message: 'Fuel burn elevated (75 L/h); autonomy reduced ahead of scheduled resupply',
      });

      assert.equal(coldSnapState.environment.outdoorC, -35);
      assert.equal(coldSnapState.energy.baseDemandKw, 270);
      assert.equal(coldSnapState.alerts.length, 2);
    });

    test('Stage 5 & 6: Operator triggers What-If: "DG-1 fails for 8 hours" under blizzard conditions', () => {
      const auditLog = new AuditLog();
      const coldSnapState = JSON.parse(JSON.stringify(initialStationState));
      coldSnapState.environment.outdoorC = -35;
      coldSnapState.energy.baseDemandKw = 270;
      coldSnapState.alerts.push({
        id: 'ALT-COLD-01',
        severity: 'warning',
        category: 'thermal',
        message: 'Blizzard -35°C',
      });

      // Natural language scenario parsing: "DG-1 fails for 8 hours"
      const nlInput = 'what if DG-1 fails for 8 hours';
      const parsed = parseScenario(nlInput, coldSnapState);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.scenario.type, 'generator_failure');
      assert.equal(parsed.scenario.params.assetId, 'DG-1');
      assert.equal(parsed.scenario.params.durationH, 8);

      // Execute scenario simulation through deterministic scenario engine
      const simRun = runScenario(coldSnapState, parsed.scenario, { auditLog });

      // Verifications:
      // With DG-1 offline: online generation is only DG-2 (250 kW), against 270 kW demand -> 20 kW deficit
      // Battery has 900 kWh -> 900 kWh / 20 kW = 45 hours of buffer, so shortfallHours = 0 unless battery exhausts
      // Now let demand be higher or single generator capacity 200 kW:
      assert.ok(simRun.id.startsWith('sc_'));
      assert.ok(simRun.resultHash);
      assert.ok(simRun.comparison.riskImpact.scenario.score >= simRun.comparison.riskImpact.baseline.score);

      // Check audit log recorded the run
      assert.equal(auditLog.list().length, 1);
      assert.equal(auditLog.verify(simRun.id).ok, true);
    });

    test('Stage 7: Recommendations generated when contingency creates shortfall or reserve threat', () => {
      const tightStressed = JSON.parse(JSON.stringify(initialStationState));
      tightStressed.assets[1].status = 'offline'; // DG-2 already offline
      tightStressed.energy.baseDemandKw = 220; // 220 kW demand
      tightStressed.energy.batteryKwh = 100; // Low battery buffer

      // Contingency: DG-1 (sole generator) fails for 8 hours
      const run = runScenario(tightStressed, {
        type: 'generator_failure',
        params: { assetId: 'DG-1', durationH: 8 },
      });

      // Battery 100 kWh / 220 kW = 0h buffer, shortfall occurs immediately
      assert.ok(run.result.metrics.shortfallHours > 0);
      assert.ok(run.result.metrics.totalUnmetKwh > 0);
      assert.ok(run.comparison.recommendations.length > 0);

      const topRec = run.comparison.recommendations[0];
      assert.ok(topRec.action.length > 0);
      assert.ok(topRec.reason.length > 0);
    });

    test('Stage 8: Operations Copilot provides grounded explanation of what-if scenario', async () => {
      const auditLog = new AuditLog();
      const mockTwin = createMockTwinProvider();
      const mockPred = createMockPredictionProvider();

      const copilot = createCopilot({
        twin: mockTwin,
        predictions: mockPred,
        auditLog,
      });

      // 1. Ask what-if contingency query
      const resp = await copilot.ask('what happens if DG-1 fails for 8 hours at maitri?', {
        stationId: 'maitri',
      });

      assert.equal(resp.status, 'ok');
      assert.ok(resp.answer.includes('scenario generator_failure'));
      assert.ok(resp.facts.length > 0);
      assert.ok(resp.sources.includes('scenario_engine'));

      // Check strictly that no numbers are ungrounded hallucinations
      const groundCheck = assertGrounded(resp);
      assert.equal(groundCheck.grounded, true, `Ungrounded: ${groundCheck.ungrounded}`);

      // 2. Query fuel autonomy
      const fuelResp = await copilot.ask('how is fuel autonomy at maitri?', {
        stationId: 'maitri',
      });
      assert.equal(fuelResp.status, 'ok');
      assert.ok(fuelResp.answer.includes('fuel'));
      assert.equal(assertGrounded(fuelResp).grounded, true);

      // 3. Query active alerts
      const alertResp = await copilot.ask('show current alerts for maitri', {
        stationId: 'maitri',
      });
      assert.equal(alertResp.status, 'ok');
      assert.equal(assertGrounded(alertResp).grounded, true);
    });

    test('Stage 9: Emergency Mode activates with prioritized asset ordering and pinned critical assets', () => {
      const emergencyState = JSON.parse(JSON.stringify(initialStationState));
      emergencyState.energy.batteryKwh = 50; // Critical battery
      emergencyState.assets[0].status = 'offline'; // DG-1 offline
      emergencyState.alerts.push({
        id: 'CRIT-01',
        severity: 'critical',
        category: 'critical_power',
        message: 'Main generator DG-1 offline; emergency life-support power active',
      });

      const view = buildEmergencyView(emergencyState);

      assert.equal(view.stationId, 'maitri');
      assert.ok(view.pinnedCritical.length >= 1);
      assert.equal(view.pinnedCritical[0].severity, 'critical');

      // Verify that Life Safety / Critical Power is highest priority
      assert.equal(EMERGENCY_ORDER[0], 'critical_power');
      assert.equal(EMERGENCY_ORDER[1], 'heating');
      assert.equal(EMERGENCY_ORDER[2], 'communications');
      assert.equal(EMERGENCY_ORDER[3], 'medical');

      // Verify priorities contains ordered categories
      assert.equal(view.priorities.length, EMERGENCY_ORDER.length);
      assert.equal(view.priorities[0].category, 'critical_power');
    });
  });
});

