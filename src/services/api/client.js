// POLARTWIN API client — the ONLY place in the frontend that calls fetch()
// for backend data. UI components and hooks go through these functions.
//
// Contract: v1 integration contract (see src/types/api.js).
//   GET /health
//   GET /api/v1/stations
//   GET /api/v1/stations/{station_id}
//   GET /api/v1/stations/{station_id}/overview
//   GET /api/v1/stations/{station_id}/assets
//   GET /api/v1/stations/{station_id}/telemetry?range=&parameter=

/** @typedef {import('../../types/api.js').Station} Station */
/** @typedef {import('../../types/api.js').StationOverview} StationOverview */
/** @typedef {import('../../types/api.js').Asset} Asset */
/** @typedef {import('../../types/api.js').TelemetryPoint} TelemetryPoint */

export const DEFAULT_API_BASE_URL = 'http://localhost:8000'
export const DEFAULT_TIMEOUT_MS = 60000 // 60 seconds (allows backend cold start / DB init)

/** Supported telemetry ranges in the v1 contract. */
export const TELEMETRY_RANGES = Object.freeze(['1h', '6h', '24h', '7d', '30d'])
export const DEFAULT_TELEMETRY_RANGE = '24h'

/**
 * kind:
 *  - 'network'          fetch rejected (backend down, DNS, CORS, offline)
 *  - 'timeout'          no response within the timeout
 *  - 'aborted'          caller cancelled (e.g. station switched)
 *  - 'http'             non-2xx response (see `status`)
 *  - 'parse'            body was not valid JSON / not the expected top-level shape
 *  - 'invalid-request'  rejected locally before any network call
 */
export class ApiError extends Error {
  /**
   * @param {'network'|'timeout'|'aborted'|'http'|'parse'|'invalid-request'} kind
   * @param {string} message
   * @param {{status?: number, url?: string, cause?: unknown}} [details]
   */
  constructor(kind, message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = details.status
    this.url = details.url
    this.code = details.code // backend error code, e.g. 'STATION_NOT_FOUND'
    if (details.cause !== undefined) this.cause = details.cause
  }
}

/**
 * Normalises a configured base URL: trims whitespace and trailing slashes,
 * and falls back to the development default when absent/blank.
 * @param {unknown} raw
 * @returns {string}
 */
export function resolveBaseUrl(raw) {
  if (typeof raw !== 'string') return DEFAULT_API_BASE_URL
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed || DEFAULT_API_BASE_URL
}

/** Reads VITE_API_BASE_URL (undefined outside Vite, e.g. under `node --test`). */
export function readEnvBaseUrl() {
  return import.meta.env?.VITE_API_BASE_URL
}

/** Reads VITE_API_TIMEOUT_MS (e.g. 60000) or falls back to DEFAULT_TIMEOUT_MS. */
export function readEnvTimeoutMs() {
  const raw = import.meta.env?.VITE_API_TIMEOUT_MS
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = Number(raw)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_TIMEOUT_MS
}

/**
 * Builds an absolute URL. Query params that are undefined/null/'' are omitted.
 * @param {string} baseUrl
 * @param {string} path  must start with '/'
 * @param {Record<string, string|number|undefined|null>} [query]
 */
export function buildUrl(baseUrl, path, query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    params.append(key, String(value))
  }
  const qs = params.toString()
  return `${resolveBaseUrl(baseUrl)}${path}${qs ? `?${qs}` : ''}`
}

function stationPath(stationId, suffix = '') {
  if (typeof stationId !== 'string' || stationId.trim() === '') {
    throw new ApiError('invalid-request', 'stationId must be a non-empty string')
  }
  return `/api/v1/stations/${encodeURIComponent(stationId.trim())}${suffix}`
}

function expectObject(body, url) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('parse', 'Expected a JSON object response', { url })
  }
  return body
}

// NOTE: pagination is not defined in v1. Until it is, list endpoints are
// expected to return a bare JSON array; anything else is a 'parse' error so
// a schema change surfaces loudly instead of rendering as "no data".
function expectArray(body, url) {
  if (!Array.isArray(body)) {
    throw new ApiError('parse', 'Expected a JSON array response', { url })
  }
  return body
}

/**
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 */
export function createApiClient(options = {}) {
  const baseUrl = resolveBaseUrl(options.baseUrl)
  const timeoutMs = options.timeoutMs ?? readEnvTimeoutMs()
  // Late-bound so tests (and polyfills) that replace globalThis.fetch work.
  const doFetch = options.fetchImpl || ((...args) => globalThis.fetch(...args))

  async function request(path, { method = 'GET', body, headers = {}, query, signal } = {}) {
    const url = buildUrl(baseUrl, path, query)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onExternalAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    const fetchHeaders = {
      Accept: 'application/json',
      ...headers,
    }
    let fetchBody
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        fetchBody = body
      } else {
        fetchHeaders['Content-Type'] = 'application/json'
        fetchBody = JSON.stringify(body)
      }
    }

    try {
      let res
      try {
        res = await doFetch(url, {
          method,
          headers: fetchHeaders,
          body: fetchBody,
          signal: controller.signal,
        })
      } catch (err) {
        if (timedOut) throw new ApiError('timeout', `Request timed out after ${timeoutMs} ms`, { url, cause: err })
        if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled', { url, cause: err })
        throw new ApiError('network', 'Backend unreachable', { url, cause: err })
      }
      if (!res.ok) {
        // The backend answers errors as {error: {code, message, details}}; use it
        // when present, but never fail because the body is absent/odd.
        let code
        let detail
        try {
          const errBody = await res.json()
          code = typeof errBody?.error?.code === 'string' ? errBody.error.code : undefined
          detail = typeof errBody?.error?.message === 'string' ? errBody.error.message : undefined
        } catch {
          /* body not JSON — ignore */
        }
        const base = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
        throw new ApiError('http', detail ? `${base}: ${detail}` : base, { status: res.status, url, code })
      }
      try {
        return { body: await res.json(), url }
      } catch (err) {
        throw new ApiError('parse', 'Response was not valid JSON', { status: res.status, url, cause: err })
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  return {
    baseUrl,
    timeoutMs,

    /** Generic request helper */
    request,

    /** Generic POST helper */
    async post(path, body, { headers, query, signal } = {}) {
      const { body: resBody } = await request(path, { method: 'POST', body, headers, query, signal })
      return resBody
    },

    /** GET /health — shape not specified in v1; returned as-is. */
    async getHealth({ signal } = {}) {
      const { body } = await request('/health', { signal })
      return body
    },

    /** GET /api/v1/stations @returns {Promise<Station[]>} */
    async getStations({ signal } = {}) {
      const { body, url } = await request('/api/v1/stations', { signal })
      return expectArray(body, url)
    },

    /** GET /api/v1/stations/{id} @returns {Promise<Station>} */
    async getStation(stationId, { signal } = {}) {
      const { body, url } = await request(stationPath(stationId), { signal })
      return expectObject(body, url)
    },

    /** GET /api/v1/stations/{id}/overview @returns {Promise<StationOverview>} */
    async getStationOverview(stationId, { signal } = {}) {
      const { body, url } = await request(stationPath(stationId, '/overview'), { signal })
      return expectObject(body, url)
    },

    /** GET /api/v1/stations/{id}/assets @returns {Promise<Asset[]>} */
    async getStationAssets(stationId, { signal } = {}) {
      const { body, url } = await request(stationPath(stationId, '/assets'), { signal })
      return expectArray(body, url)
    },

    /**
     * GET /api/v1/stations/{id}/telemetry?range=&parameter=
     * @param {string} stationId
     * @param {{range?: '1h'|'6h'|'24h'|'7d'|'30d', parameter?: string, signal?: AbortSignal}} [opts]
     * @returns {Promise<TelemetryPoint[]>}
     */
    async getStationTelemetry(stationId, { range = DEFAULT_TELEMETRY_RANGE, parameter, signal } = {}) {
      if (!TELEMETRY_RANGES.includes(range)) {
        throw new ApiError(
          'invalid-request',
          `Unsupported telemetry range "${range}" (supported: ${TELEMETRY_RANGES.join(', ')})`
        )
      }
      const { body, url } = await request(stationPath(stationId, '/telemetry'), {
        query: { range, parameter },
        signal,
      })
      return expectArray(body, url)
    },

    /** POST /api/v1/auth/token — Mint a dev/test bearer token */
    async createToken(payload, { signal } = {}) {
      const { body } = await request('/api/v1/auth/token', { method: 'POST', body: payload, signal })
      return body
    },

    /** POST /api/v1/telemetry/ingest — Ingest telemetry readings/events */
    async ingestTelemetry(events, { token, signal } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const payload = Array.isArray(events) ? { events } : events
      const { body } = await request('/api/v1/telemetry/ingest', {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
      return body
    },

    /** POST /api/v1/runtime/step — Advance simulation clock by one tick */
    async stepRuntime({ token, signal } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const { body } = await request('/api/v1/runtime/step', {
        method: 'POST',
        headers,
        signal,
      })
      return body
    },

    /** POST /api/v1/runtime/{station_id}/perturb — Inject scenario perturbation */
    async perturbStation(stationId, perturbation, { token, signal } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const { body } = await request(`/api/v1/runtime/${encodeURIComponent(stationId)}/perturb`, {
        method: 'POST',
        headers,
        body: perturbation,
        signal,
      })
      return body
    },

    /** POST /api/v1/alerts/{alert_id}/acknowledge — Acknowledge an active alert */
    async acknowledgeAlert(alertId, note = '', { token, signal } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const { body } = await request(`/api/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST',
        headers,
        body: { note },
        signal,
      })
      return body
    },

    /** GET /api/v1/runtime/status — Runtime simulation status */
    async getRuntimeStatus({ token, signal } = {}) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const { body } = await request('/api/v1/runtime/status', {
        headers,
        signal,
      })
      return body
    },
  }
}

// Default app-wide client, configured from Vite env (VITE_API_BASE_URL, VITE_API_TIMEOUT_MS).
export const apiClient = createApiClient({
  baseUrl: readEnvBaseUrl(),
  timeoutMs: readEnvTimeoutMs(),
})

export const getHealth = (...a) => apiClient.getHealth(...a)
export const getStations = (...a) => apiClient.getStations(...a)
export const getStation = (...a) => apiClient.getStation(...a)
export const getStationOverview = (...a) => apiClient.getStationOverview(...a)
export const getStationAssets = (...a) => apiClient.getStationAssets(...a)
export const getStationTelemetry = (...a) => apiClient.getStationTelemetry(...a)
export const createToken = (...a) => apiClient.createToken(...a)
export const ingestTelemetry = (...a) => apiClient.ingestTelemetry(...a)
export const stepRuntime = (...a) => apiClient.stepRuntime(...a)
export const perturbStation = (...a) => apiClient.perturbStation(...a)
export const acknowledgeAlert = (...a) => apiClient.acknowledgeAlert(...a)
export const getRuntimeStatus = (...a) => apiClient.getRuntimeStatus(...a)
