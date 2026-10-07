// Agent 4C — adapter layer for Agent 4A (twin runtime) and Agent 4B (ML).
//
// These are DEVELOPMENT MOCKS ONLY. They define the shape 4C expects and return
// deterministic data. They do not implement dependency propagation or ML. Real
// 4A/4B services must satisfy the same interfaces (see docs/phase4/agent4c-contracts.md).

export class DependencyUnavailableError extends Error {
  constructor(dep, reason = 'unavailable') { super(`${dep} ${reason}`); this.dep = dep; this.code = 'DEPENDENCY_UNAVAILABLE'; }
}

const STATIONS = {
  maitri: {
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
    thermal: { indoorC: 20 }, comms: { linkQuality: 0.9 }, environment: { outdoorC: -12, windMs: 9 },
    alerts: [{ id: 'A-1', severity: 'warning', category: 'infrastructure', message: 'LAB-1 vibration above normal' }],
  },
  bharati: {
    assets: [
      { id: 'DG-1', type: 'generator', status: 'online', capacityKw: 200 },
      { id: 'DG-2', type: 'generator', status: 'online', capacityKw: 200 },
      { id: 'MED-1', type: 'medical', status: 'online' },
      { id: 'COM-1', type: 'comms', status: 'online' },
      { id: 'WTR-1', type: 'water', status: 'offline' },
    ],
    energy: { baseDemandKw: 150, batteryKwh: 500, batteryCapacityKwh: 800 },
    fuel: { tankL: 9000, resupplyL: 15000 },
    logistics: { nextResupplyH: 60 },
    thermal: { indoorC: 19 }, comms: { linkQuality: 0.7 }, environment: { outdoorC: -9, windMs: 14 },
    alerts: [{ id: 'A-2', severity: 'critical', category: 'infrastructure', message: 'WTR-1 pump offline' }],
  },
};

const HOUR = 3600000;
const hoursOf = (iso) => Math.floor(Date.parse(iso) / HOUR);

/** Deterministic stand-in for the 4A twin runtime (as_of aware). */
export function createMockTwinProvider({ stations = STATIONS, calls = [] } = {}) {
  const ensure = (id) => {
    if (!stations[id]) throw new DependencyUnavailableError('twin', `unknown station ${id}`);
    return stations[id];
  };
  return {
    calls,
    async getState(stationId, { asOf } = {}) {
      calls.push({ fn: 'getState', stationId, asOf });
      const base = JSON.parse(JSON.stringify(ensure(stationId)));
      const iso = asOf || '2026-01-01T00:00:00.000Z';
      const h = hoursOf(iso);
      base.stationId = stationId;
      base.asOf = iso;
      base.environment.outdoorC = Math.round((base.environment.outdoorC + 6 * Math.sin((2 * Math.PI * (h % 24)) / 24)) * 10) / 10;
      base.energy.baseDemandKw = Math.round(base.energy.baseDemandKw * (1 + 0.08 * Math.sin((2 * Math.PI * (h % 24)) / 24)));
      return base;
    },
    async getEvents(stationId, { from, to } = {}) {
      calls.push({ fn: 'getEvents', stationId, from, to });
      ensure(stationId);
      const out = [];
      const start = hoursOf(from), end = hoursOf(to);
      for (let h = start; h <= end; h++) {
        if (h % 6 === 0) {
          out.push({ ts: new Date(h * HOUR).toISOString(), type: h % 12 === 0 ? 'alert' : 'maintenance', message: `Event @${h % 100}`, severity: h % 12 === 0 ? 'warning' : 'info' });
        }
      }
      return out;
    },
    async getTelemetry(stationId, { metric = 'demandKw', from, to } = {}) {
      calls.push({ fn: 'getTelemetry', stationId, metric, from, to });
      ensure(stationId);
      const pts = [];
      for (let h = hoursOf(from); h <= hoursOf(to); h++) {
        pts.push({ ts: new Date(h * HOUR).toISOString(), value: Math.round((100 + 20 * Math.sin((2 * Math.PI * (h % 24)) / 24)) * 100) / 100 });
      }
      return { metric, points: pts };
    },
  };
}

/** Deterministic stand-in for 4B prediction/risk/maintenance services. */
export function createMockPredictionProvider() {
  const model = { name: 'mock-linear', version: '0.0.0-mock' };
  return {
    async getForecast(stationId, { metric = 'demandKw', horizonH = 24, asOf } = {}) {
      const points = [];
      for (let t = 0; t <= horizonH; t += 6) points.push({ offsetH: t, value: Math.round((100 - t * 0.5) * 100) / 100 });
      return { stationId, metric, asOf: asOf || null, points, model };
    },
    async getAnomalies(stationId, { asOf } = {}) {
      return [{ assetId: 'LAB-1', metric: 'vibration', severity: 'warning', score: 0.71, ts: asOf || null, model }];
    },
    async getMaintenance(stationId) {
      return [{ assetId: 'LAB-1', action: 'Inspect bearings', dueInDays: 5, failureProbability: 0.22, model }];
    },
    async getRisk(stationId, { asOf } = {}) {
      return { stationId, asOf: asOf || null, score: 31, level: 'moderate', drivers: ['LAB-1 degraded'], model };
    },
  };
}

/** Simulates a missing backend / missing model for failure-mode tests and offline UI. */
export function createUnavailableProvider(dep = 'dependency') {
  return new Proxy({}, { get: () => async () => { throw new DependencyUnavailableError(dep); } });
}

/**
 * Live HTTP Twin Provider that queries Agent 4A FastAPI runtime endpoints:
 *   - getState: GET /api/v1/runtime/{stationId}/state
 *   - getEvents: GET /api/v1/events?station_id={stationId}
 *   - getTelemetry: GET /api/v1/stations/{stationId}/telemetry?metric={metric}
 * Falls back gracefully to mock provider if backend is offline and fallbackToMock is true.
 */
export function createHttpTwinProvider({
  baseUrl = 'http://localhost:8000',
  fetch = globalThis.fetch,
  token = null,
  fallbackToMock = true,
  mock = createMockTwinProvider(),
} = {}) {
  const headers = () => {
    const h = { Accept: 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  return {
    async getState(stationId, { asOf } = {}) {
      try {
        const url = new URL(`${baseUrl}/api/v1/runtime/${encodeURIComponent(stationId)}/state`);
        if (asOf) url.searchParams.set('as_of', asOf);
        const res = await fetch(url.toString(), { headers: headers() });
        if (!res.ok) {
          if (fallbackToMock) return await mock.getState(stationId, { asOf });
          throw new DependencyUnavailableError('twin', `HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        if (fallbackToMock) return await mock.getState(stationId, { asOf });
        if (err instanceof DependencyUnavailableError) throw err;
        throw new DependencyUnavailableError('twin', err.message);
      }
    },

    async getEvents(stationId, { from, to, limit = 100 } = {}) {
      try {
        const url = new URL(`${baseUrl}/api/v1/events`);
        if (stationId) url.searchParams.set('station_id', stationId);
        if (limit) url.searchParams.set('limit', String(limit));
        const res = await fetch(url.toString(), { headers: headers() });
        if (!res.ok) {
          if (fallbackToMock) return await mock.getEvents(stationId, { from, to });
          throw new DependencyUnavailableError('twin', `HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        return data.map((e) => ({
          ts: e.occurred_at,
          type: e.event_type || 'event',
          message: e.message,
          severity: e.severity || 'info',
          id: e.id,
          stationId: e.station_id,
        }));
      } catch (err) {
        if (fallbackToMock) return await mock.getEvents(stationId, { from, to });
        if (err instanceof DependencyUnavailableError) throw err;
        throw new DependencyUnavailableError('twin', err.message);
      }
    },

    async getTelemetry(stationId, { metric = 'demandKw', from, to } = {}) {
      try {
        const url = new URL(`${baseUrl}/api/v1/stations/${encodeURIComponent(stationId)}/telemetry`);
        if (metric) url.searchParams.set('metric', metric);
        if (from) url.searchParams.set('start', from);
        if (to) url.searchParams.set('end', to);
        url.searchParams.set('order', 'asc');
        const res = await fetch(url.toString(), { headers: headers() });
        if (!res.ok) {
          if (fallbackToMock) return await mock.getTelemetry(stationId, { metric, from, to });
          throw new DependencyUnavailableError('twin', `HTTP ${res.status}: ${res.statusText}`);
        }
        const items = await res.json();
        const points = items.map((r) => ({
          ts: r.observed_at || r.timestamp,
          value: r.value,
        }));
        return { metric, points };
      } catch (err) {
        if (fallbackToMock) return await mock.getTelemetry(stationId, { metric, from, to });
        if (err instanceof DependencyUnavailableError) throw err;
        throw new DependencyUnavailableError('twin', err.message);
      }
    },
  };
}

/**
 * Live Prediction Provider wrapping Agent 4B's createIntelligenceService.
 * Bridges 4B intelligence capabilities directly into 4C decision and copilot layers.
 */
export function createLivePredictionProvider(intelligenceService, { fallbackToMock = true, mock = createMockPredictionProvider() } = {}) {
  const svc = intelligenceService;
  return {
    async getForecast(stationId, opts = {}) {
      try {
        return await svc.getForecast(stationId, opts);
      } catch (err) {
        if (fallbackToMock) return await mock.getForecast(stationId, opts);
        throw err;
      }
    },
    async getAnomalies(stationId, opts = {}) {
      try {
        return await svc.getAnomalies(stationId, opts);
      } catch (err) {
        if (fallbackToMock) return await mock.getAnomalies(stationId, opts);
        throw err;
      }
    },
    async getMaintenance(stationId, opts = {}) {
      try {
        return await svc.getMaintenance(stationId, opts);
      } catch (err) {
        if (fallbackToMock) return await mock.getMaintenance(stationId, opts);
        throw err;
      }
    },
    async getRisk(stationId, opts = {}) {
      try {
        return await svc.getRisk(stationId, opts);
      } catch (err) {
        if (fallbackToMock) return await mock.getRisk(stationId, opts);
        throw err;
      }
    },
    async getRecommendations(stationId, opts = {}) {
      try {
        return await svc.getRecommendations(stationId, opts);
      } catch (err) {
        if (fallbackToMock && mock.getRecommendations) return await mock.getRecommendations(stationId, opts);
        throw err;
      }
    },
  };
}

