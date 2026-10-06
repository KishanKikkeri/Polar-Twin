// Provenance + quality mapping. Provenance must never be hidden: every
// non-REAL_OBSERVATION value is visibly labelled as such in the UI.

/** @typedef {import('../../types/api.js').DataProvenance} DataProvenance */
/** @typedef {import('../../types/api.js').DataQuality} DataQuality */

// tone drives styling only:  real (green) | simulated (amber) | derived (cyan) | unknown (grey)
const PROVENANCE = {
  REAL_OBSERVATION: { label: 'REAL OBSERVATION', tone: 'real', isReal: true, note: 'Measured by a real sensor/observation.' },
  SYNTHETIC: { label: 'SYNTHETIC', tone: 'simulated', isReal: false, note: 'Synthetic data — not a real observation.' },
  SIMULATED: { label: 'SIMULATED', tone: 'simulated', isReal: false, note: 'Simulated data — not a real observation.' },
  SCENARIO: { label: 'SCENARIO', tone: 'simulated', isReal: false, note: 'Scenario / what-if data — not a real observation.' },
  DERIVED: { label: 'DERIVED', tone: 'derived', isReal: false, note: 'Derived from other data — not a direct observation.' },
  PREDICTED: { label: 'PREDICTED', tone: 'derived', isReal: false, note: 'Model prediction — not a direct observation.' },
}

const UNKNOWN_PROVENANCE = {
  code: 'UNKNOWN',
  label: 'PROVENANCE UNKNOWN',
  tone: 'unknown',
  isReal: false,
  note: 'The backend did not state where this data came from; do not treat it as real.',
}

/**
 * Backend values are canonical UPPER_SNAKE, but the overview example uses a
 * lowercase `data_status` ("simulated"), so matching is case-insensitive.
 * @param {unknown} value
 * @returns {DataProvenance|'UNKNOWN'}
 */
export function normalizeProvenance(value) {
  if (typeof value !== 'string') return 'UNKNOWN'
  const code = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  return Object.prototype.hasOwnProperty.call(PROVENANCE, code) ? /** @type {DataProvenance} */ (code) : 'UNKNOWN'
}

/**
 * @param {unknown} value
 * @returns {{code: string, label: string, tone: 'real'|'simulated'|'derived'|'unknown', isReal: boolean, note: string}}
 */
export function describeProvenance(value) {
  const code = normalizeProvenance(value)
  if (code === 'UNKNOWN') return UNKNOWN_PROVENANCE
  return { code, ...PROVENANCE[code] }
}

// usable: may the value be shown as a number? flagged: show a caution marker.
const QUALITY = {
  VALID: { label: 'VALID', usable: true, flagged: false },
  ESTIMATED: { label: 'ESTIMATED', usable: true, flagged: true },
  INTERPOLATED: { label: 'INTERPOLATED', usable: true, flagged: true },
  SUSPECT: { label: 'SUSPECT', usable: true, flagged: true },
  MISSING: { label: 'MISSING', usable: false, flagged: true },
  INVALID: { label: 'INVALID', usable: false, flagged: true },
}

/**
 * @param {unknown} value
 * @returns {{code: DataQuality|'UNKNOWN', label: string, usable: boolean, flagged: boolean}}
 */
export function describeQuality(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (Object.prototype.hasOwnProperty.call(QUALITY, code)) return { code: /** @type {DataQuality} */ (code), ...QUALITY[code] }
  return { code: 'UNKNOWN', label: 'QUALITY UNKNOWN', usable: true, flagged: true }
}
