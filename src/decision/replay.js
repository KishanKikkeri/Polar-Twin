// Agent 4C — historical replay.
// Twin-state reconstruction is delegated to the existing as_of model: every frame is
// provider.getState(stationId, { asOf }). 4C never re-derives state itself.

const HOUR = 3600000;
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v));
const toIso = (ms) => new Date(ms).toISOString();

export function createReplay({ provider, stationId, from, to, stepMs = HOUR }) {
  const fromMs = toMs(from), toMsV = toMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsV) || fromMs >= toMsV) {
    throw new RangeError('Replay range invalid: from must be earlier than to');
  }
  const clampMs = (ms) => Math.min(toMsV, Math.max(fromMs, ms));

  return {
    stationId,
    range: { from: toIso(fromMs), to: toIso(toMsV), stepMs },
    steps: Math.floor((toMsV - fromMs) / stepMs) + 1,

    /** One replay frame: reconstructed twin state + events up to the cursor. Never reads "now". */
    async frameAt(at) {
      const asOf = toIso(clampMs(toMs(at)));
      try {
        const state = await provider.getState(stationId, { asOf });
        let events = [], warnings = [];
        if (typeof provider.getEvents === 'function') {
          try {
            events = (await provider.getEvents(stationId, { from: toIso(fromMs), to: asOf }))
              .filter((e) => Date.parse(e.ts) <= Date.parse(asOf)) // never leak events from after the cursor
              .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
          } catch { warnings.push('events_unavailable'); }
        } else warnings.push('events_unavailable');
        return { available: true, asOf, state, events, warnings };
      } catch (e) {
        return { available: false, asOf, reason: e.code || 'BACKEND_UNAVAILABLE', message: 'Historical state unavailable; nothing is being substituted.' };
      }
    },

    /** Telemetry window ending at the cursor (for trend charts during replay). */
    async telemetryUpTo(at, metric = 'demandKw', windowMs = 24 * HOUR) {
      const end = clampMs(toMs(at));
      try {
        return { available: true, ...(await provider.getTelemetry(stationId, { metric, from: toIso(clampMs(end - windowMs)), to: toIso(end) })) };
      } catch { return { available: false, metric, points: [] }; }
    },
  };
}

// Pure controller state machine (UI-agnostic; drive `tick` from a timer in the React layer).
export function initialReplayState({ from, to, stepMs = HOUR }) {
  return { fromMs: toMs(from), toMs: toMs(to), stepMs, cursorMs: toMs(from), playing: false, speed: 1 };
}

export function replayReducer(s, action) {
  const clamp = (ms) => Math.min(s.toMs, Math.max(s.fromMs, ms));
  switch (action.type) {
    case 'seek': return { ...s, cursorMs: clamp(toMs(action.to)), playing: false };
    case 'step': return { ...s, cursorMs: clamp(s.cursorMs + action.dir * s.stepMs), playing: false };
    case 'play': return s.cursorMs >= s.toMs ? { ...s, cursorMs: s.fromMs, playing: true } : { ...s, playing: true };
    case 'pause': return { ...s, playing: false };
    case 'speed': return { ...s, speed: Math.max(0.25, Math.min(3600, action.value)) };
    case 'tick': {
      if (!s.playing) return s;
      const next = clamp(s.cursorMs + s.stepMs * s.speed);
      return { ...s, cursorMs: next, playing: next < s.toMs };
    }
    default: return s;
  }
}
