// Agent 4C — shared constants and pure helpers. No I/O, no clock, no randomness.

export const ENGINE_VERSION = '1.0.0';
export const SCENARIO_SCHEMA_VERSION = 1;

// Placeholder physical coefficients. Versioned with ENGINE_VERSION: changing any
// value MUST bump ENGINE_VERSION so audit records stay interpretable.
export const COEFFS = Object.freeze({
  fuelLPerKwh: 0.28,
  heatingKwPerDegC: 1.2,
  degradedFactor: 0.6,
  indoorSetpointC: 20,
  indoorCoolRateCPerH: 1.5,
  indoorRecoverRateCPerH: 1.0,
});

export const SCENARIO_TYPES = Object.freeze({
  temperature_drop: { label: 'Temperature drop', defaultHorizonH: 24,
    params: { deltaC: { min: 1, max: 60, default: 10 }, durationH: { min: 1, max: 168, default: 12 } } },
  generator_failure: { label: 'Generator failure', defaultHorizonH: 24, requiresAsset: 'generator',
    params: { durationH: { min: 1, max: 168, default: 8 } } },
  battery_degradation: { label: 'Battery capacity loss', defaultHorizonH: 24,
    params: { capacityLossPct: { min: 1, max: 100, default: 30 } } },
  demand_increase: { label: 'Increased demand', defaultHorizonH: 24,
    params: { pct: { min: 1, max: 300, default: 25 }, durationH: { min: 1, max: 168, default: 12 } } },
  fuel_shortage: { label: 'Fuel shortage', defaultHorizonH: 72,
    params: { lossPct: { min: 1, max: 100, default: 40 } } },
  resupply_delay: { label: 'Resupply delay', defaultHorizonH: 168,
    params: { delayH: { min: 1, max: 720, default: 72 } } },
  comms_degradation: { label: 'Communication degradation', defaultHorizonH: 24,
    params: { qualityLossPct: { min: 1, max: 100, default: 50 }, durationH: { min: 1, max: 168, default: 6 } } },
});

export const round = (n, d = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return n ?? null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const deepClone = (v) => JSON.parse(JSON.stringify(v));
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

export function canonicalize(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Non-cryptographic content hash (two FNV-1a lanes). Good enough to detect
// accidental drift between audit record and replay; NOT tamper-proof.
export function contentHash(v) {
  const s = canonicalize(v);
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const generators = (state) => (state.assets || []).filter((a) => a.type === 'generator');
export const onlineCapacityKw = (state) =>
  generators(state).reduce((s, g) => s + (g.status === 'offline' ? 0 : g.capacityKw * (g.status === 'degraded' ? COEFFS.degradedFactor : 1)), 0);
export const batteryPct = (state) => (state.energy.batteryCapacityKwh > 0 ? (state.energy.batteryKwh / state.energy.batteryCapacityKwh) * 100 : 0);
export const fuelAutonomyH = (state) => state.fuel.tankL / Math.max(state.energy.baseDemandKw * COEFFS.fuelLPerKwh, 0.001);
