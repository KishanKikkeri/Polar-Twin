import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, ApiError } from '../src/services/api/client.js'
import { loadStationTwin, mergeRefresh } from '../src/services/twin/loadStationTwin.js'
import { buildTwinView, deriveHeadline } from '../src/services/twin/twinView.js'
import { describeProvenance, describeQuality, normalizeProvenance } from '../src/services/twin/provenance.js'
import { assessFreshness, formatUtc, parseIsoTimestamp, DEFAULT_STALE_AFTER_MS } from '../src/services/twin/freshness.js'
import { mapSeverity, adaptBackendAlert, adaptLocalAlert } from '../src/services/twin/severity.js'
import { groupAssetsByObject, describeAssetStatus } from '../src/services/twin/assetMapping.js'
import { describeTelemetryPoint } from '../src/services/twin/telemetry.js'
import { formatValue } from '../src/services/twin/formatters.js'
import { jsonResponse, mockFetch } from './helpers.js'

const BASE = 'http://api.test'
const NOW = Date.parse('2026-10-06T18:10:00Z')

const overview = (over = {}) => ({
  station_id: 'maitri',
  station_name: 'Maitri',
  status: 'operational',
  last_updated: '2026-10-06T18:05:00Z',
  data_status: 'SIMULATED',
  domains: { environment: { air_temperature: -18.2, wind: null }, energy: {}, logistics: {}, infrastructure: {} },
  active_alerts: [],
  risk: { score: null, severity: 'unknown' },
  ...over,
})

// 6. Fallback to simulation ------------------------------------------------
test('backend fully down -> connection=unavailable, nothing fabricated', async () => {
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => { throw new TypeError('down') }) })
  const twin = await loadStationTwin(c, 'maitri', { now: () => NOW })
  assert.equal(twin.connection, 'unavailable')
  assert.equal(twin.overview, null)
  assert.equal(twin.assets, null)
  assert.equal(twin.station, null)
  assert.ok(twin.errors.overview instanceof ApiError)
})

test('fallback view model is explicitly labelled SIMULATED and never claims operational', async () => {
  const c = createApiClient({ baseUrl: BASE, fetchImpl: mockFetch(() => { throw new TypeError('down') }) })
  const twin = await loadStationTwin(c, 'maitri')
  const view = buildTwinView(twin, { localAlerts: [{ id: 'l1', level: 'warn', title: 'T', message: 'M', objectId: 'fuel-farm' }] })
  assert.equal(view.usingLocalSimulation, true)
  assert.equal(view.connection.state, 'unavailable')
  assert.match(view.connection.label, /SIMULATED/)
  assert.match(view.connection.label, /Backend unavailable/)
  assert.equal(view.overview, null)
  assert.notEqual(view.headline.label, 'OPERATIONAL')
  assert.equal(view.headline.label, 'STATUS UNKNOWN')
  assert.equal(view.alertsOrigin, 'local-simulated')
  assert.equal(view.alerts[0].origin, 'local-simulated')
})

test('while loading (no twin yet) the connection says so, not "connected"', () => {
  const view = buildTwinView(null, { loading: true })
  assert.equal(view.connection.state, 'loading')
})

test('overview ok but assets fail -> still connected; assets error recorded, assets null (not [])', async () => {
  const c = createApiClient({
    baseUrl: BASE,
    fetchImpl: mockFetch((url) => (url.endsWith('/overview') ? jsonResponse(overview()) : jsonResponse({}, { status: 500 }))),
  })
  const twin = await loadStationTwin(c, 'maitri')
  assert.equal(twin.connection, 'connected')
  assert.equal(twin.assets, null)
  assert.equal(twin.errors.assets.kind, 'http')
})

test('overview fails but other calls succeed -> partial, overview falls back', async () => {
  const c = createApiClient({
    baseUrl: BASE,
    fetchImpl: mockFetch((url) => (url.endsWith('/assets') ? jsonResponse([]) : jsonResponse({}, { status: 500 }))),
  })
  const twin = await loadStationTwin(c, 'maitri')
  assert.equal(twin.connection, 'partial')
  const view = buildTwinView(twin)
  assert.equal(view.connection.state, 'partial')
  assert.equal(view.usingLocalSimulation, true)
})

test('station switching: requests are made for the requested station only', async () => {
  const f = mockFetch(() => jsonResponse({}))
  const c = createApiClient({ baseUrl: BASE, fetchImpl: f })
  await loadStationTwin(c, 'bharati')
  assert.ok(f.calls.every((x) => x.url.includes('/stations/bharati')))
})

test('mergeRefresh: failed refresh retains last good overview but flags it', async () => {
  const good = { stationId: 'maitri', connection: 'connected', station: null, overview: overview(), assets: [], errors: {}, fetchedAt: 1, retained: false }
  const failed = { stationId: 'maitri', connection: 'unavailable', station: null, overview: null, assets: null, errors: { overview: new ApiError('network', 'x') }, fetchedAt: 2, retained: false }
  const merged = mergeRefresh(good, failed)
  assert.equal(merged.retained, true)
  assert.equal(merged.overview.station_id, 'maitri')
  assert.match(buildTwinView(merged, { now: NOW }).connection.label, /retained/)
  // different station -> never carry data across
  assert.equal(mergeRefresh(good, { ...failed, stationId: 'bharati' }).overview, null)
  // successful refresh replaces
  assert.equal(mergeRefresh(good, { ...good, fetchedAt: 3 }).fetchedAt, 3)
})

test('retained overview ages to STALE and headline stops claiming operational', () => {
  const retained = { stationId: 'maitri', connection: 'unavailable', station: null, overview: overview(), assets: null, errors: {}, fetchedAt: 1, retained: true }
  const view = buildTwinView(retained, { now: NOW + 60 * 60 * 1000 })
  assert.equal(view.overview.freshness.state, 'stale')
  assert.match(view.headline.label, /STALE/)
})

// 7. Provenance mapping ----------------------------------------------------
test('all six provenance values map; only REAL_OBSERVATION is real', () => {
  const codes = ['REAL_OBSERVATION', 'SYNTHETIC', 'DERIVED', 'PREDICTED', 'SIMULATED', 'SCENARIO']
  for (const code of codes) {
    const p = describeProvenance(code)
    assert.equal(p.code, code)
    assert.equal(p.isReal, code === 'REAL_OBSERVATION')
  }
  assert.equal(describeProvenance('SIMULATED').label, 'SIMULATED')
  assert.equal(describeProvenance('REAL_OBSERVATION').tone, 'real')
  assert.equal(describeProvenance('SIMULATED').tone, 'simulated')
})

test('provenance is case-insensitive (overview example uses lowercase "simulated")', () => {
  assert.equal(normalizeProvenance('simulated'), 'SIMULATED')
  assert.equal(normalizeProvenance(' real-observation '), 'REAL_OBSERVATION')
})

test('unknown / missing provenance is never treated as real', () => {
  for (const v of [undefined, null, '', 'LIVE', 'real', 42]) {
    const p = describeProvenance(v)
    assert.equal(p.code, 'UNKNOWN')
    assert.equal(p.isReal, false)
  }
})

test('quality mapping: unusable values are flagged', () => {
  assert.equal(describeQuality('VALID').flagged, false)
  for (const q of ['MISSING', 'INVALID']) assert.equal(describeQuality(q).usable, false)
  for (const q of ['ESTIMATED', 'INTERPOLATED', 'SUSPECT']) assert.equal(describeQuality(q).flagged, true)
  assert.equal(describeQuality('???').code, 'UNKNOWN')
})

test('overview view model carries SIMULATED provenance from data_status', () => {
  const view = buildTwinView({ stationId: 'maitri', connection: 'connected', overview: overview({ data_status: 'simulated' }), assets: [], station: null, errors: {}, fetchedAt: NOW, retained: false }, { now: NOW })
  assert.equal(view.overview.provenance.label, 'SIMULATED')
  assert.equal(view.overview.provenance.isReal, false)
  assert.equal(view.usingLocalSimulation, false)
  assert.equal(view.connection.label, 'Connected — Backend')
})

// 8. Stale-data handling ---------------------------------------------------
test('freshness: current / stale / missing / unknown', () => {
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00Z', now: NOW }).state, 'current')
  assert.equal(assessFreshness({ timestamp: '2026-10-06T17:00:00Z', now: NOW }).state, 'stale')
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00Z', value: null, now: NOW }).state, 'missing')
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00Z', quality: 'MISSING', now: NOW }).state, 'missing')
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00Z', quality: 'INVALID', now: NOW }).state, 'unknown')
  assert.equal(assessFreshness({ now: NOW }).state, 'unknown')
  assert.equal(assessFreshness({ timestamp: 'garbage', now: NOW }).state, 'unknown')
})

test('freshness: threshold boundary and override', () => {
  const at = new Date(NOW - DEFAULT_STALE_AFTER_MS).toISOString()
  assert.equal(assessFreshness({ timestamp: at, now: NOW }).state, 'current')
  assert.equal(assessFreshness({ timestamp: new Date(NOW - DEFAULT_STALE_AFTER_MS - 1000).toISOString(), now: NOW }).state, 'stale')
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00Z', now: NOW, staleAfterMs: 60 * 1000 }).state, 'stale')
})

test('timestamps: timezone is never assumed (naive timestamps are not trusted)', () => {
  assert.equal(parseIsoTimestamp('2026-10-06T18:00:00'), null)
  assert.equal(assessFreshness({ timestamp: '2026-10-06T18:05:00', now: NOW }).state, 'unknown')
  // explicit offsets are honoured: 23:35+05:30 == 18:05Z
  assert.equal(parseIsoTimestamp('2026-10-06T23:35:00+05:30'), Date.parse('2026-10-06T18:05:00Z'))
  assert.equal(assessFreshness({ timestamp: '2026-10-06T23:35:00+05:30', now: NOW }).state, 'current')
  assert.equal(formatUtc('2026-10-06T23:35:00+05:30'), '2026-10-06 18:05:00 UTC')
  assert.equal(formatUtc('nope'), '—')
})

test('timestamps in the far future are unknown, small clock skew is tolerated', () => {
  assert.equal(assessFreshness({ timestamp: new Date(NOW + 2 * 60 * 1000).toISOString(), now: NOW }).state, 'current')
  assert.equal(assessFreshness({ timestamp: new Date(NOW + 2 * 3600 * 1000).toISOString(), now: NOW }).state, 'unknown')
})

test('headline never says OPERATIONAL from stale/unknown/missing data', () => {
  const fresh = (state) => ({ state, label: state.toUpperCase(), reason: 'r' })
  assert.equal(deriveHeadline('operational', fresh('current')).label, 'OPERATIONAL')
  assert.match(deriveHeadline('operational', fresh('stale')).label, /STALE/)
  assert.equal(deriveHeadline('operational', fresh('unknown')).label, 'STATUS UNKNOWN')
  assert.equal(deriveHeadline('operational', fresh('missing')).label, 'STATUS UNKNOWN')
  assert.equal(deriveHeadline('weird', fresh('current')).label, 'UNKNOWN')
})

test('telemetry point: null value is "—" (never 0); invalid quality hides the number', () => {
  const base = { telemetry_id: 't', station_id: 'maitri', parameter: 'temperature', unit: '°C', source_type: 'SIMULATED', timestamp: '2026-10-06T18:05:00Z' }
  const missing = describeTelemetryPoint({ ...base, value: null, quality: 'MISSING' }, { now: NOW })
  assert.equal(missing.display, '—')
  assert.equal(missing.freshness.state, 'missing')
  const invalid = describeTelemetryPoint({ ...base, value: 999, quality: 'INVALID' }, { now: NOW })
  assert.equal(invalid.display, '—')
  const ok = describeTelemetryPoint({ ...base, value: -18.2, quality: 'VALID' }, { now: NOW })
  assert.equal(ok.display, '-18.2 °C')
  assert.equal(ok.provenance.label, 'SIMULATED')
  const zero = describeTelemetryPoint({ ...base, value: 0, quality: 'VALID' }, { now: NOW })
  assert.equal(zero.display, '0 °C', 'a real zero is still shown')
  assert.equal(formatValue(undefined), '—')
})

test('overview: null risk score and empty domains are explicit, not zeros', () => {
  const view = buildTwinView({ stationId: 'maitri', connection: 'connected', overview: overview(), assets: [], station: null, errors: {}, fetchedAt: NOW, retained: false }, { now: NOW })
  assert.equal(view.overview.risk.score, null)
  assert.equal(view.overview.risk.scoreDisplay, '—')
  assert.equal(view.overview.risk.label, 'UNKNOWN')
  const env = view.overview.domains.find((d) => d.key === 'environment')
  assert.deepEqual(env.rows.map((r) => [r.key, r.value, r.missing]), [['air_temperature', '-18.2', false], ['wind', '—', true]])
  assert.equal(view.overview.domains.find((d) => d.key === 'energy').empty, true)
})

// 9. Severity mapping ------------------------------------------------------
test('severity: backend canonical -> existing UI levels', () => {
  assert.equal(mapSeverity('INFO').level, 'normal')
  assert.equal(mapSeverity('WARNING').level, 'warn')
  assert.equal(mapSeverity('HIGH').level, 'critical')
  assert.equal(mapSeverity('CRITICAL').level, 'critical')
  assert.equal(mapSeverity('warning').level, 'warn')
})

test('severity: unknown/missing never renders as reassuring "normal"', () => {
  for (const v of [undefined, null, '', 'BANANA']) {
    const m = mapSeverity(v)
    assert.equal(m.level, 'warn')
    assert.equal(m.known, false)
  }
})

test('adaptBackendAlert keeps original severity and does not invent object links', () => {
  const a = adaptBackendAlert({
    alert_id: 'al-1', station_id: 'maitri', source: 'fuel', severity: 'HIGH', title: 'Fuel', description: 'Low', created_at: '2026-10-06T18:00:00Z', recommended_action: 'Refuel',
  })
  assert.equal(a.id, 'al-1')
  assert.equal(a.severity, 'HIGH')
  assert.equal(a.level, 'critical')
  assert.equal(a.message, 'Low')
  assert.equal(a.objectId, undefined)
  assert.equal(a.origin, 'backend')
})

test('local demo alerts keep their level but are flagged local-simulated', () => {
  const a = adaptLocalAlert({ id: 'x', level: 'warn', title: 'T', message: 'M', objectId: 'fuel-farm' })
  assert.equal(a.level, 'warn')
  assert.equal(a.origin, 'local-simulated')
  assert.equal(a.objectId, 'fuel-farm')
})

test('backend alerts feed the view; empty active_alerts is an empty list, not demo data', () => {
  const view = buildTwinView({ stationId: 'maitri', connection: 'connected', overview: overview(), assets: [], station: null, errors: {}, fetchedAt: NOW, retained: false }, { now: NOW, localAlerts: [{ id: 'l', level: 'warn', title: 't', message: 'm' }] })
  assert.equal(view.alertsOrigin, 'backend')
  assert.deepEqual(view.alerts, [])
})

// Asset association --------------------------------------------------------
test('assets are grouped by building_id == local object id; others are unmatched', () => {
  const objects = [{ id: 'power-house' }, { id: 'fuel-farm' }]
  const assets = [
    { asset_id: '1', building_id: 'power-house' },
    { asset_id: '2', building_id: 'power-house' },
    { asset_id: '3', building_id: 'unknown-building' },
    { asset_id: '4' },
  ]
  const g = groupAssetsByObject(assets, objects)
  assert.deepEqual(g.byObjectId['power-house'].map((a) => a.asset_id), ['1', '2'])
  assert.equal(g.byObjectId['fuel-farm'], undefined)
  assert.deepEqual(g.unmatched.map((a) => a.asset_id), ['3', '4'])
  assert.deepEqual(groupAssetsByObject(null, objects), { byObjectId: {}, unmatched: [] })
})

test('asset status tones', () => {
  assert.equal(describeAssetStatus('failed').tone, 'critical')
  assert.equal(describeAssetStatus('maintenance').tone, 'warn')
  assert.equal(describeAssetStatus('operational').tone, 'normal')
  assert.equal(describeAssetStatus('???').tone, 'unknown')
})
