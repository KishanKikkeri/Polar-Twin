// Frontend adapter: backend canonical severities -> the existing visual
// system (`normal` | `warn` | `critical`). The backend is NOT shaped around
// the UI's levels; the original severity stays on the adapted alert so the UI
// can show the real value.

/** @typedef {import('../../types/api.js').Alert} Alert */
/** @typedef {'normal'|'warn'|'critical'} UiLevel */

const SEVERITY_TO_LEVEL = {
  INFO: 'normal',
  WARNING: 'warn',
  HIGH: 'critical', // above WARNING; escalated to the red style (label still reads "HIGH")
  CRITICAL: 'critical',
}

/**
 * Unrecognised/missing severities map to 'warn' so they are never rendered as
 * a reassuring green "normal".
 * @param {unknown} severity
 * @returns {{severity: string, level: UiLevel, known: boolean}}
 */
export function mapSeverity(severity) {
  const code = typeof severity === 'string' ? severity.trim().toUpperCase() : ''
  if (Object.prototype.hasOwnProperty.call(SEVERITY_TO_LEVEL, code)) {
    return { severity: code, level: SEVERITY_TO_LEVEL[code], known: true }
  }
  return { severity: code || 'UNKNOWN', level: 'warn', known: false }
}

/**
 * Backend Alert -> shape consumed by <Alerts/>.
 * `objectId` is intentionally left undefined: v1 gives alerts a free-form
 * `source`, not an asset/building id, so alerts are not linked to 3D objects.
 * @param {Alert} alert
 */
export function adaptBackendAlert(alert) {
  const { severity, level, known } = mapSeverity(alert?.severity)
  return {
    id: alert?.alert_id ?? `${alert?.source ?? 'alert'}-${alert?.created_at ?? ''}-${alert?.title ?? ''}`,
    origin: 'backend',
    level,
    severity,
    severityKnown: known,
    title: alert?.title ?? 'Untitled alert',
    message: alert?.description ?? '',
    source: alert?.source,
    createdAt: alert?.created_at,
    status: alert?.status,
    acknowledged: alert?.acknowledged,
    recommendedAction: alert?.recommended_action,
    objectId: undefined,
  }
}

/** Local (hard-coded demo) alert -> same shape; always flagged as simulated. */
export function adaptLocalAlert(alert) {
  return {
    id: alert.id,
    origin: 'local-simulated',
    level: alert.level in { normal: 1, warn: 1, critical: 1 } ? alert.level : 'warn',
    severity: null,
    severityKnown: true,
    title: alert.title,
    message: alert.message,
    objectId: alert.objectId,
  }
}
