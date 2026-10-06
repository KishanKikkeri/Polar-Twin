import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  DEFAULT_API_BASE_URL,
  buildUrl,
  createApiClient,
  resolveBaseUrl,
} from '../src/services/api/client.js'
import { jsonResponse, mockFetch } from './helpers.js'

const BASE = 'http://api.test:9000'

// 1. URL construction ------------------------------------------------------
test('resolveBaseUrl: falls back to http://localhost:8000 when absent/blank', () => {
  assert.equal(DEFAULT_API_BASE_URL, 'http://localhost:8000')
  assert.equal(resolveBaseUrl(undefined), 'http://localhost:8000')
  assert.equal(resolveBaseUrl(''), 'http://localhost:8000')
  assert.equal(resolveBaseUrl('   '), 'http://localhost:8000')
})

test('resolveBaseUrl: trims whitespace and trailing slashes', () => {
  assert.equal(resolveBaseUrl(' http://x.test:1/// '), 'http://x.test:1')
})

test('buildUrl: joins path, omits empty query params, encodes values', () => {
  assert.equal(buildUrl(BASE, '/health'), `${BASE}/health`)
  assert.equal(buildUrl(BASE + '/', '/a', { range: '24h', parameter: undefined, x: null, y: '' }), `${BASE}/a?range=24h`)
  assert.equal(buildUrl(BASE, '/a', { parameter: 'air temp' }), `${BASE}/a?parameter=air+temp`)
})

test('client calls the documented v1 paths', async () => {
  const f = mockFetch((url) => jsonResponse(url.endsWith('/stations') || /assets|telemetry/.test(url) ? [] : {}))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  await c.getHealth()
  await c.getStations()
  await c.getStation('maitri')
  await c.getStationOverview('maitri')
  await c.getStationAssets('bharati')
  await c.getStationTelemetry('maitri')
  assert.deepEqual(
    f.calls.map((x) => x.url),
    [
      `${BASE}/health`,
      `${BASE}/api/v1/stations`,
      `${BASE}/api/v1/stations/maitri`,
      `${BASE}/api/v1/stations/maitri/overview`,
      `${BASE}/api/v1/stations/bharati/assets`,
      `${BASE}/api/v1/stations/maitri/telemetry?range=24h`,
    ]
  )
  assert.ok(f.calls.every((x) => x.init.method === 'GET' && x.init.headers.Accept === 'application/json'))
})

test('station id is URL-encoded and validated', async () => {
  const f = mockFetch(() => jsonResponse({}))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  await c.getStation('a/b c')
  assert.equal(f.calls[0].url, `${BASE}/api/v1/stations/a%2Fb%20c`)
  await assert.rejects(() => c.getStation(''), (e) => e instanceof ApiError && e.kind === 'invalid-request')
  assert.equal(f.calls.length, 1, 'no network call for an invalid id')
})

// 2 & 3. Station + overview retrieval ------------------------------------
test('getStations returns the station list', async () => {
  const body = [
    { station_id: 'maitri', station_name: 'Maitri', status: 'operational' },
    { station_id: 'bharati', station_name: 'Bharati', status: 'operational' },
  ]
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse(body)) })
  assert.deepEqual(await c.getStations(), body)
})

test('getStation returns station metadata', async () => {
  const body = { station_id: 'maitri', station_name: 'Maitri', status: 'operational', latitude: -70.7653, longitude: 11.7358 }
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse(body)) })
  assert.deepEqual(await c.getStation('maitri'), body)
})

test('getStationOverview returns the overview (extra backend fields preserved)', async () => {
  const body = {
    station_id: 'maitri',
    station_name: 'Maitri',
    status: 'operational',
    last_updated: '2026-10-06T18:00:00Z',
    data_status: 'simulated',
    domains: { environment: {}, energy: {}, logistics: {}, infrastructure: {} },
    active_alerts: [],
    risk: { score: null, severity: 'unknown' },
    some_new_backend_field: 1,
  }
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse(body)) })
  assert.deepEqual(await c.getStationOverview('maitri'), body)
})

test('getStationAssets returns an array', async () => {
  const body = [{ asset_id: 'a1', station_id: 'maitri', asset_type: 'generator', name: 'DG-1', status: 'operational' }]
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse(body)) })
  assert.deepEqual(await c.getStationAssets('maitri'), body)
})

// 4. Telemetry query parameters ------------------------------------------
test('telemetry: range and parameter are sent as query params', async () => {
  const f = mockFetch(() => jsonResponse([]))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  await c.getStationTelemetry('maitri', { range: '24h', parameter: 'temperature' })
  assert.equal(f.calls[0].url, `${BASE}/api/v1/stations/maitri/telemetry?range=24h&parameter=temperature`)
})

test('telemetry: every supported range is accepted; parameter is optional', async () => {
  const f = mockFetch(() => jsonResponse([]))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  for (const range of ['1h', '6h', '24h', '7d', '30d']) await c.getStationTelemetry('bharati', { range })
  assert.deepEqual(
    f.calls.map((x) => x.url.split('?')[1]),
    ['range=1h', 'range=6h', 'range=24h', 'range=7d', 'range=30d']
  )
})

test('telemetry: unsupported range is rejected locally with no network call', async () => {
  const f = mockFetch(() => jsonResponse([]))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  await assert.rejects(
    () => c.getStationTelemetry('maitri', { range: '5y' }),
    (e) => e instanceof ApiError && e.kind === 'invalid-request'
  )
  assert.equal(f.calls.length, 0)
})

// 5. API failure ----------------------------------------------------------
test('HTTP error -> ApiError(kind=http, status)', async () => {
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse({}, { status: 503, statusText: 'Service Unavailable' })) })
  await assert.rejects(() => c.getStations(), (e) => e instanceof ApiError && e.kind === 'http' && e.status === 503)
})

test('404 is an http error, not an empty result', async () => {
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse({}, { status: 404 })) })
  await assert.rejects(() => c.getStation('nope'), (e) => e.kind === 'http' && e.status === 404)
})

test('network failure -> ApiError(kind=network)', async () => {
  const c = createApiClient({
    baseUrl: BASE,
    fetchImpl: mockFetch(() => {
      throw new TypeError('fetch failed')
    }),
  })
  await assert.rejects(() => c.getStations(), (e) => e instanceof ApiError && e.kind === 'network')
})

test('invalid JSON -> ApiError(kind=parse)', async () => {
  const bad = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => bad) })
  await assert.rejects(() => c.getStations(), (e) => e.kind === 'parse')
})

test('unexpected top-level shape -> parse error (list endpoints need arrays, others objects)', async () => {
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse({ items: [] })) })
  await assert.rejects(() => c.getStations(), (e) => e.kind === 'parse')
  await assert.rejects(() => c.getStationAssets('maitri'), (e) => e.kind === 'parse')
  await assert.rejects(() => c.getStationTelemetry('maitri'), (e) => e.kind === 'parse')
  const c2 = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => jsonResponse([])) })
  await assert.rejects(() => c2.getStationOverview('maitri'), (e) => e.kind === 'parse')
})

const hangingFetch = () =>
  mockFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
  )

test('timeout -> ApiError(kind=timeout)', async () => {
  const c = createApiClient({ baseUrl: BASE, timeoutMs: 20, fetchImpl: hangingFetch() })
  await assert.rejects(() => c.getStations(), (e) => e.kind === 'timeout')
})

test('caller abort -> ApiError(kind=aborted)', async () => {
  const c = createApiClient({ baseUrl: BASE, timeoutMs: 5000, fetchImpl: hangingFetch() })
  const ctrl = new AbortController()
  const p = c.getStations({ signal: ctrl.signal })
  ctrl.abort()
  await assert.rejects(() => p, (e) => e.kind === 'aborted')
})
