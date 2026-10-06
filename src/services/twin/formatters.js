// Display helpers. Missing values are rendered as an explicit "—" — never as
// 0 or any other fabricated number.

export const UNAVAILABLE = '—'

/** @param {unknown} v */
export function isMissing(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && v.trim() === '')
}

/**
 * @param {unknown} v
 * @param {{digits?: number, unit?: string}} [opts]
 */
export function formatValue(v, { digits, unit } = {}) {
  if (isMissing(v)) return UNAVAILABLE
  if (typeof v === 'number') {
    const n = digits === undefined ? String(v) : v.toFixed(digits)
    return unit ? `${n} ${unit}` : n
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return unit ? `${v} ${unit}` : v
  return UNAVAILABLE // objects/arrays are not rendered as scalars
}

/** "some_key" -> "Some key" */
export function humanizeKey(key) {
  const s = String(key).replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
