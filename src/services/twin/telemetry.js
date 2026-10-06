// View helper for a single TelemetryPoint: combines provenance, quality,
// freshness and a display value that is never a fabricated number.

import { describeProvenance, describeQuality } from './provenance.js'
import { assessFreshness } from './freshness.js'
import { formatValue } from './formatters.js'

/** @typedef {import('../../types/api.js').TelemetryPoint} TelemetryPoint */

/**
 * @param {TelemetryPoint} point
 * @param {{now?: number|Date, staleAfterMs?: number}} [opts]
 */
export function describeTelemetryPoint(point, opts = {}) {
  const quality = describeQuality(point?.quality)
  const provenance = describeProvenance(point?.source_type)
  const freshness = assessFreshness({
    timestamp: point?.timestamp,
    quality: point?.quality,
    value: point?.value === undefined ? null : point.value,
    ...opts,
  })
  // INVALID/MISSING values are never shown as numbers.
  const showValue = quality.usable && freshness.state !== 'missing'
  return {
    parameter: point?.parameter,
    display: showValue ? formatValue(point?.value, { unit: point?.unit }) : formatValue(null),
    provenance,
    quality,
    freshness,
  }
}
