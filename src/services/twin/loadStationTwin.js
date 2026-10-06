// Loads everything the twin needs for ONE station from the backend and
// reports honestly how much of it arrived. No data is fabricated here: when a
// request fails the corresponding field is null and the error is recorded.
// The caller (UI) decides how to present the labelled local simulation.

/** @typedef {import('../../types/api.js').Station} Station */
/** @typedef {import('../../types/api.js').StationOverview} StationOverview */
/** @typedef {import('../../types/api.js').Asset} Asset */

/**
 * connection:
 *  - 'connected'   overview received from the backend
 *  - 'partial'     backend answered some requests but not the overview
 *  - 'unavailable' nothing usable received
 *
 * @typedef {Object} StationTwinData
 * @property {string} stationId
 * @property {'connected'|'partial'|'unavailable'} connection
 * @property {Station|null} station
 * @property {StationOverview|null} overview
 * @property {Asset[]|null} assets
 * @property {{station?: Error, overview?: Error, assets?: Error}} errors
 * @property {number} fetchedAt     epoch ms of this attempt
 * @property {boolean} retained     true if overview/assets are carried over from an earlier successful fetch
 */

/**
 * @param {ReturnType<import('../api/client.js').createApiClient>} client
 * @param {string} stationId
 * @param {{signal?: AbortSignal, now?: () => number}} [opts]
 * @returns {Promise<StationTwinData>}
 */
export async function loadStationTwin(client, stationId, { signal, now = Date.now } = {}) {
  const [station, overview, assets] = await Promise.allSettled([
    client.getStation(stationId, { signal }),
    client.getStationOverview(stationId, { signal }),
    client.getStationAssets(stationId, { signal }),
  ])

  const errors = {}
  if (station.status === 'rejected') errors.station = station.reason
  if (overview.status === 'rejected') errors.overview = overview.reason
  if (assets.status === 'rejected') errors.assets = assets.reason

  const anyOk = [station, overview, assets].some((r) => r.status === 'fulfilled')
  const connection = overview.status === 'fulfilled' ? 'connected' : anyOk ? 'partial' : 'unavailable'

  return {
    stationId,
    connection,
    station: station.status === 'fulfilled' ? station.value : null,
    overview: overview.status === 'fulfilled' ? overview.value : null,
    assets: assets.status === 'fulfilled' ? assets.value : null,
    errors,
    fetchedAt: now(),
    retained: false,
  }
}

/**
 * Background refresh policy. If a refresh fails after an earlier success for
 * the SAME station, keep the last good overview/assets but flag them as
 * `retained` (the UI labels them and freshness ages them to STALE) rather
 * than silently swapping real data for simulation on a transient blip.
 *
 * @param {StationTwinData|null} prev
 * @param {StationTwinData} next
 * @returns {StationTwinData}
 */
export function mergeRefresh(prev, next) {
  if (!prev || prev.stationId !== next.stationId) return next
  const lostOverview = next.overview === null && prev.overview !== null
  if (!lostOverview) return next
  return {
    ...next,
    connection: 'unavailable',
    station: next.station ?? prev.station,
    overview: prev.overview,
    assets: next.assets ?? prev.assets,
    retained: true,
  }
}
