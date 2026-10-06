// Associates backend assets with the existing 3D station objects.
//
// ASSUMPTION (v1 contract does not define the mapping): an Asset's
// `building_id` equals the local station-config object `id` (e.g.
// 'power-house', 'fuel-farm'). Assets without a `building_id`, or whose id
// matches no local object, are returned as `unmatched` and are NOT drawn.
// Asset x/y/z are ignored: their coordinate frame is not specified.

/** @typedef {import('../../types/api.js').Asset} Asset */

/**
 * @param {Asset[]|null|undefined} assets
 * @param {{id: string}[]} objects  local station objects (src/data/stations)
 * @returns {{byObjectId: Record<string, Asset[]>, unmatched: Asset[]}}
 */
export function groupAssetsByObject(assets, objects) {
  const ids = new Set((objects || []).map((o) => o.id))
  /** @type {Record<string, Asset[]>} */
  const byObjectId = {}
  /** @type {Asset[]} */
  const unmatched = []
  for (const asset of assets || []) {
    const key = asset?.building_id
    if (key && ids.has(key)) (byObjectId[key] ||= []).push(asset)
    else unmatched.push(asset)
  }
  return { byObjectId, unmatched }
}

const ASSET_STATUS_TONE = {
  operational: 'normal',
  degraded: 'warn',
  maintenance: 'warn',
  failed: 'critical',
  unknown: 'unknown',
}

/** @param {unknown} status @returns {{label: string, tone: 'normal'|'warn'|'critical'|'unknown'}} */
export function describeAssetStatus(status) {
  const code = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (Object.prototype.hasOwnProperty.call(ASSET_STATUS_TONE, code)) {
    return { label: code.toUpperCase(), tone: ASSET_STATUS_TONE[code] }
  }
  return { label: 'UNKNOWN', tone: 'unknown' }
}
