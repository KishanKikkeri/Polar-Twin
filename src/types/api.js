// POLARTWIN — v1 integration contract (frontend view of the backend API).
//
// SINGLE SOURCE OF TRUTH for the shapes exchanged with the POLARTWIN backend.
// These are JSDoc typedefs only (the app is JavaScript/JSX; no TypeScript
// migration). If Agent 1 finalizes a slightly different implementation,
// change the shapes HERE and adapt src/services/twin/* — UI components never
// read raw backend payloads directly.
//
// Importing this module has no runtime effect; it exists so editors/JSDoc
// can resolve the typedefs:  /** @type {import('../types/api.js').Station} */

/**
 * @typedef {'operational'|'degraded'|'offline'|'unknown'} StationStatus
 */

/**
 * @typedef {Object} Station
 * @property {string} station_id
 * @property {string} station_name
 * @property {StationStatus} status
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {number} [elevation]
 */

/**
 * @typedef {Object} Building
 * @property {string} building_id
 * @property {string} station_id
 * @property {string} name
 * @property {string} [type]
 * @property {Object} [geometry]
 * @property {number} [floor_count]
 * @property {number} [area]
 */

/**
 * @typedef {'operational'|'degraded'|'failed'|'maintenance'|'unknown'} AssetStatus
 */

/**
 * @typedef {Object} Asset
 * @property {string} asset_id
 * @property {string} station_id
 * @property {string} [building_id]
 * @property {string} asset_type
 * @property {string} name
 * @property {AssetStatus} status
 * @property {number|null} [health]
 * @property {string} [criticality]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 */

/**
 * Where a value came from. Must never be hidden in the UI.
 * @typedef {'REAL_OBSERVATION'|'SYNTHETIC'|'DERIVED'|'PREDICTED'|'SIMULATED'|'SCENARIO'} DataProvenance
 */

/**
 * @typedef {'VALID'|'MISSING'|'ESTIMATED'|'INTERPOLATED'|'SUSPECT'|'INVALID'} DataQuality
 */

/**
 * `timestamp` is an ISO-8601 timestamp. Never assume the browser timezone.
 * @typedef {Object} TelemetryPoint
 * @property {string} telemetry_id
 * @property {string} station_id
 * @property {string} [sensor_id]
 * @property {string} timestamp
 * @property {string} parameter
 * @property {number|null} value
 * @property {string} unit
 * @property {DataProvenance} source_type
 * @property {DataQuality} quality
 */

/**
 * Backend canonical severities. The existing UI's lowercase
 * `warn` / `normal` / `critical` is produced by a frontend adapter
 * (src/services/twin/severity.js); the backend is not shaped around it.
 * @typedef {'INFO'|'WARNING'|'HIGH'|'CRITICAL'} AlertSeverity
 */

/**
 * @typedef {Object} Alert
 * @property {string} alert_id
 * @property {string} station_id
 * @property {string} source
 * @property {AlertSeverity} severity
 * @property {string} title
 * @property {string} description
 * @property {string} created_at
 * @property {string} [status]
 * @property {boolean} [acknowledged]
 * @property {string} [recommended_action]
 */

/**
 * @typedef {Object} RiskSummary
 * @property {number|null} score
 * @property {'low'|'medium'|'high'|'critical'|'unknown'} severity
 * @property {string[]} [contributing_factors]
 * @property {string} [trend]
 */

/**
 * Domain objects are intentionally extensible: detailed energy/logistics
 * schemas are NOT defined in v1 and must not be assumed by the frontend.
 * @typedef {Object} StationOverview
 * @property {string} station_id
 * @property {string} station_name
 * @property {StationStatus} status
 * @property {string} last_updated
 * @property {DataProvenance} data_status
 * @property {Object} domains
 * @property {Object} domains.environment
 * @property {Object} domains.energy
 * @property {Object} domains.logistics
 * @property {Object} domains.infrastructure
 * @property {Alert[]} active_alerts
 * @property {RiskSummary} risk
 */

export {}
