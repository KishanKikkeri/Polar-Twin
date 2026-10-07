// Freshness (Current / Stale / Missing / Unknown) from backend timestamp +
// quality. Timestamps are ISO-8601 and MUST carry an explicit timezone
// designator (Z or ±hh:mm); a naive timestamp would be parsed in the
// browser's local zone, which we refuse to assume, so it yields "unknown".

/** @typedef {'current'|'stale'|'missing'|'unknown'} FreshnessState */

// Frontend display assumption (NOT part of the v1 contract): data older than
// this is shown as STALE. 30 min matches the smallest per-channel
// `stale_after_seconds` (1800 s) the real backend uses, so the UI does not
// call data stale while the backend still considers it FRESH. Callers may
// override per use.
export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000
// Tolerated client/server clock skew before a "future" timestamp is distrusted.
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i

/**
 * @param {unknown} ts
 * @returns {number|null} epoch ms, or null if absent/unparseable/no timezone
 */
export function parseIsoTimestamp(ts) {
  if (typeof ts !== 'string') return null
  const trimmed = ts.trim()
  if (!ISO_WITH_TZ.test(trimmed)) return null
  const ms = Date.parse(trimmed.replace(' ', 'T'))
  return Number.isNaN(ms) ? null : ms
}

const LABELS = { current: 'CURRENT', stale: 'STALE', missing: 'MISSING', unknown: 'UNKNOWN' }

/**
 * @param {{
 *   timestamp?: unknown,
 *   quality?: unknown,
 *   value?: number|null,   // pass for telemetry: null/NaN => missing. Omit when n/a.
 *   now?: number|Date,
 *   staleAfterMs?: number,
 * }} input
 * @returns {{state: FreshnessState, label: string, reason: string, ageMs: number|null, timestampMs: number|null}}
 */
export function assessFreshness({ timestamp, quality, value, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now
  let q = typeof quality === 'string' ? quality.trim().toUpperCase() : ''
  if (q === 'BAD') q = 'INVALID' // backend vocabulary (see provenance.js)
  const make = (state, reason, ageMs = null, timestampMs = null) => ({ state, label: LABELS[state], reason, ageMs, timestampMs })

  const valueMissing = value === null || (typeof value === 'number' && Number.isNaN(value))
  if (valueMissing || q === 'MISSING') return make('missing', valueMissing ? 'value-null' : 'quality-missing')
  if (q === 'INVALID') return make('unknown', 'quality-invalid')

  const ts = parseIsoTimestamp(timestamp)
  if (ts === null) {
    return make('unknown', typeof timestamp === 'string' && timestamp.trim() ? 'timestamp-unparseable-or-no-timezone' : 'timestamp-absent')
  }
  const age = nowMs - ts
  if (age < -FUTURE_TOLERANCE_MS) return make('unknown', 'timestamp-in-future', age, ts)
  if (age > staleAfterMs) return make('stale', 'older-than-threshold', age, ts)
  return make('current', 'within-threshold', Math.max(0, age), ts)
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; '—' when unknown. */
export function formatAge(ageMs) {
  if (typeof ageMs !== 'number' || Number.isNaN(ageMs)) return '—'
  const s = Math.max(0, Math.round(ageMs / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** Explicit-UTC display ("2026-10-06 18:00:00 UTC"); never uses the local zone. */
export function formatUtc(timestamp) {
  const ms = parseIsoTimestamp(timestamp)
  if (ms === null) return '—'
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}
