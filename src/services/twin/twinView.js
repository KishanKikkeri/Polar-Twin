// Pure view-model builder: backend/twin state -> what the UI renders.
// Keeps all "what do we claim, and how do we label it" decisions in one
// testable place, so components stay dumb.

import { describeProvenance } from './provenance.js'
import { assessFreshness, formatAge, formatUtc } from './freshness.js'
import { adaptBackendAlert, adaptLocalAlert } from './severity.js'
import { formatValue, humanizeKey, isMissing } from './formatters.js'

/** @typedef {import('./loadStationTwin.js').StationTwinData} StationTwinData */

const STATION_STATUS = {
  operational: { label: 'OPERATIONAL', tone: 'normal' },
  degraded: { label: 'DEGRADED', tone: 'warn' },
  offline: { label: 'OFFLINE', tone: 'critical' },
  unknown: { label: 'UNKNOWN', tone: 'unknown' },
}

export function describeStationStatus(status) {
  const code = typeof status === 'string' ? status.trim().toLowerCase() : ''
  return Object.prototype.hasOwnProperty.call(STATION_STATUS, code) ? STATION_STATUS[code] : STATION_STATUS.unknown
}

/** @returns {{state: 'loading'|'connected'|'partial'|'unavailable', label: string, detail: string, tone: string}} */
export function describeConnection(twin, { loading = false } = {}) {
  if (!twin) {
    return loading
      ? { state: 'loading', label: 'Checking backend…', detail: 'Waiting for the backend to respond.', tone: 'unknown' }
      : { state: 'unavailable', label: 'SIMULATED — Backend unavailable', detail: 'No backend data; local simulation is shown.', tone: 'warn' }
  }
  if (twin.connection === 'connected') {
    return { state: 'connected', label: 'Connected — Backend', detail: 'Overview received from the backend.', tone: 'normal' }
  }
  if (twin.retained) {
    return {
      state: 'unavailable',
      label: 'Backend unreachable — last data retained',
      detail: 'Showing the last overview received; it will age to STALE.',
      tone: 'warn',
    }
  }
  if (twin.connection === 'partial') {
    return { state: 'partial', label: 'PARTIAL — Overview unavailable', detail: 'Some backend requests failed; local simulation is shown for the overview.', tone: 'warn' }
  }
  return { state: 'unavailable', label: 'SIMULATED — Backend unavailable', detail: 'No backend data; local simulation is shown.', tone: 'warn' }
}

const DOMAIN_KEYS = ['environment', 'energy', 'logistics', 'infrastructure']

/**
 * Domain objects are extensible and unspecified in v1, so only primitive
 * fields are listed generically; nested values are not interpreted.
 */
function buildDomains(domains) {
  return DOMAIN_KEYS.map((key) => {
    const obj = domains && typeof domains[key] === 'object' && domains[key] !== null ? domains[key] : null
    const rows = obj
      ? Object.entries(obj)
          .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
          .slice(0, 8)
          .map(([k, v]) => ({ key: k, label: humanizeKey(k), value: formatValue(v), missing: isMissing(v) }))
      : []
    const hiddenCount = obj ? Object.keys(obj).length - rows.length : 0
    return { key, label: humanizeKey(key), rows, hiddenCount, empty: !obj || Object.keys(obj).length === 0 }
  })
}

const RISK_LABEL = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', critical: 'CRITICAL', unknown: 'UNKNOWN' }
const RISK_TONE = { low: 'normal', medium: 'warn', high: 'critical', critical: 'critical', unknown: 'unknown' }

export function describeRisk(risk) {
  const sev = typeof risk?.severity === 'string' ? risk.severity.trim().toLowerCase() : 'unknown'
  const code = Object.prototype.hasOwnProperty.call(RISK_LABEL, sev) ? sev : 'unknown'
  return {
    score: isMissing(risk?.score) ? null : risk.score,
    scoreDisplay: formatValue(risk?.score),
    severity: code,
    label: RISK_LABEL[code],
    tone: RISK_TONE[code],
    factors: Array.isArray(risk?.contributing_factors) ? risk.contributing_factors : [],
    trend: isMissing(risk?.trend) ? null : String(risk.trend),
  }
}

/**
 * Headline status. Never reports "operational" unless the data behind it is
 * established as current.
 */
export function deriveHeadline(status, freshness) {
  const s = describeStationStatus(status)
  if (freshness.state === 'missing' || freshness.state === 'unknown') {
    return { label: 'STATUS UNKNOWN', tone: 'unknown', reason: `Freshness ${freshness.label.toLowerCase()} (${freshness.reason})` }
  }
  if (freshness.state === 'stale') {
    return { label: `LAST REPORTED ${s.label} · STALE`, tone: 'warn', reason: 'Backend data is older than the freshness threshold' }
  }
  return { label: s.label, tone: s.tone, reason: 'Current' }
}

/**
 * @param {StationTwinData|null} twin
 * @param {{now?: number, loading?: boolean, staleAfterMs?: number, localAlerts?: any[]}} [opts]
 */
export function buildTwinView(twin, { now = Date.now(), loading = false, staleAfterMs, localAlerts = [] } = {}) {
  const connection = describeConnection(twin, { loading })
  const overview = twin?.overview ?? null

  if (!overview) {
    // Nothing from the backend: the UI shows the local simulation, labelled.
    return {
      connection,
      overview: null,
      usingLocalSimulation: true,
      alertsOrigin: 'local-simulated',
      alerts: localAlerts.map(adaptLocalAlert),
      headline: { label: 'STATUS UNKNOWN', tone: 'unknown', reason: 'No backend overview' },
    }
  }

  const provenance = describeProvenance(overview.data_status)
  const freshness = assessFreshness({ timestamp: overview.last_updated, now, staleAfterMs })
  const alerts = (Array.isArray(overview.active_alerts) ? overview.active_alerts : []).map(adaptBackendAlert)

  return {
    connection,
    overview: {
      stationId: overview.station_id,
      stationName: overview.station_name,
      status: describeStationStatus(overview.status),
      provenance,
      freshness,
      lastUpdatedUtc: formatUtc(overview.last_updated),
      ageLabel: formatAge(freshness.ageMs),
      domains: buildDomains(overview.domains),
      risk: describeRisk(overview.risk),
      retained: Boolean(twin.retained),
    },
    usingLocalSimulation: false,
    alertsOrigin: 'backend',
    alerts,
    headline: deriveHeadline(overview.status, freshness),
  }
}
