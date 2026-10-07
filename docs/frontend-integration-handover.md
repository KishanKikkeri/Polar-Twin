# POLARTWIN — frontend ↔ backend integration (v1 slice) — handover

Branch: `feat/frontend-twin-integration` (not merged to `main`).
Contract: v1 integration contract from the project lead. Types live in ONE file: `src/types/api.js` (JSDoc typedefs; no TypeScript migration).

## Configuration
| Variable | Default | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Added to `.env.example`. Only `VITE_*` vars reach the browser; no secrets are committed. |
| `VITE_OPENWEATHER_API_KEY` | _(unset)_ | Unchanged. |

`npm test` runs the new suite with Node's built-in runner (`node --test`) — no test dependency was added. `package.json` only gained the `test` script.

## Architecture
```
UI components ──► hooks ──► services/twin/* (pure logic) ──► services/api/client.js ──► fetch
```
- `src/services/api/client.js` — the only `fetch()` caller for backend data: `getHealth`, `getStations`, `getStation`, `getStationOverview`, `getStationAssets`, `getStationTelemetry(id, {range, parameter})`. Timeout/abort support, typed `ApiError` (`network|timeout|aborted|http|parse|invalid-request`). `createApiClient({baseUrl, fetchImpl})` for tests.
- `src/services/twin/` — provenance, quality, freshness, severity adapter, asset→object mapping, `loadStationTwin`/`mergeRefresh`, `buildTwinView` (all "what do we claim and how is it labelled" decisions).
- `src/hooks/` — `useStationTwin` (per-station load + 30 s refresh, cancels on station switch), `useBackendStations`, `useNow`.
- UI: `ui/DataBadges.jsx`, `ui/StationOverviewCard.jsx`, `dashboard/AssetInspector.jsx`.

## Changed / added files
Added: `src/types/api.js`, `src/services/api/client.js`, `src/services/twin/{provenance,freshness,severity,formatters,assetMapping,telemetry,loadStationTwin,twinView}.js`, `src/hooks/{useStationTwin,useBackendStations,useNow}.js`, `src/components/ui/{DataBadges,StationOverviewCard}.jsx`, `src/components/dashboard/AssetInspector.jsx`, `tests/*`, this note.
Modified: `src/App.jsx`, `ui/{StatusBar,TopBar,Alerts,InfoPanel,StationSelector,BlueprintHUD}.jsx`, `.env.example`, `package.json` (test script), `README.md`.
Untouched: 3D scene/renderer, station configs (`src/data/stations`), simulated data generators, weather service.

## Behaviour
- **Fallback:** if the overview can't be fetched, the app keeps working on the existing local simulation and says so (`SIMULATED — Backend unavailable`, overview card "BACKEND OVERVIEW UNAVAILABLE", headline `STATUS UNKNOWN`). States: `connected` / `partial` / `unavailable` (+ `retained` when a later refresh fails but earlier backend data exists — shown as stale-aging, labelled).
- **Removed fabricated claims:** the hard-coded "ALL SYSTEMS OPERATIONAL", "SYSTEM ONLINE", "LIVE SIMULATION", HUD "LIVE" and "LINK: STABLE" are replaced by state derived from the backend. Headline only reads `OPERATIONAL` when the data is current.
- **Provenance:** every non-`REAL_OBSERVATION` value is chipped (`SIMULATED`, `SYNTHETIC`, `DERIVED`, `PREDICTED`, `SCENARIO`; unknown ⇒ "PROVENANCE UNKNOWN", never real). Matching is case-insensitive (the contract's overview example sends `"simulated"`).
- **Local simulator readings** (status-bar TEMP/WIND/VISIBILITY, all dashboard-panel figures) are always tagged SIMULATED, including when the backend is connected, because the v1 `domains` objects carry no schema yet.
- **Freshness:** `current` / `stale` (> 15 min, frontend constant `DEFAULT_STALE_AFTER_MS`) / `missing` (null value or quality `MISSING`) / `unknown` (no/unparseable/timezone-less timestamp, `INVALID` quality, far-future timestamp). Times display in explicit UTC; the browser timezone is never assumed.
- **Missing values** render `—`, never `0`.
- **Severity adapter:** `INFO→normal`, `WARNING→warn`, `HIGH→critical`, `CRITICAL→critical`, unknown→`warn`; original severity text is still displayed.
- **Assets:** matched to 3D objects by `asset.building_id === local object id`; shown in the dashboard panel of the selected object. Unmatched assets are not drawn.

## Assumptions (please confirm with Agent 1)
1. List endpoints return a bare JSON array (pagination undefined) — anything else is a `parse` error that falls back visibly.
2. `Asset.building_id` equals the local station-config object ids (`power-house`, `fuel-farm`, …). `x/y/z` are ignored (frame undefined).
3. `Asset.health` scale is unspecified → shown raw, no `%`.
4. `Alert.source` is free-form → alerts are not linked to 3D objects.
5. Overview `domains.*` are unspecified → only primitive fields are listed generically (max 8/domain).
6. Stale threshold (15 min) is a frontend default.
7. Backend must allow CORS from the frontend origin (dev: `http://localhost:5173`).
8. The `http://localhost:8000` fallback is for development; production builds must set `VITE_API_BASE_URL`.

## Known limitations
- Telemetry is implemented in the client and view helper (`describeTelemetryPoint`) and tested, but not yet shown in any UI (the contract doesn't link telemetry to assets/panels).
- Per-system dashboard panels still render local simulated data (labelled); they are not backend-driven yet.
- `BlueprintHUD` still hard-codes Maitri's coordinates/"SYS / MAITRI-01" for every station (pre-existing, out of scope).
- Bundle is >500 kB (pre-existing warning).

## Verified against the real backend (Python 3.12, SQLite, seeded)
Frontend `npm test` (132) and `npm run build` pass; backend `pytest` (71) passes. In a headless browser against `uvicorn` on :8000, both stations load overview/assets/station with all-200 responses; overview shows `SYNTHETIC` + `CURRENT`, risk and domain values render, station switching and asset inspector (e.g. Power House) work.

Mismatches found and handled:
1. **Quality vocabulary** — backend emits `GOOD/SUSPECT/BAD/MISSING`; the v1 typedef says `VALID/…/INVALID`. Adapters now accept both (GOOD→VALID, BAD→INVALID). Typedef unchanged, with a NOTE to confirm with Agent 1.
2. **Stale threshold** — 15 min was tighter than the backend's per-channel `stale_after_seconds` (≥ 1800 s) and would show STALE while the backend says FRESH. Default is now 30 min.
3. **Error bodies** — backend errors are `{error:{code,message,details}}`; `ApiError` now carries `code` and the backend message.
4. **Backend import crash on Python < 3.14** — `app/repositories/topology.py` defines `StationRepository.list`, shadowing the builtin, so the later `list[str]` annotation raised `TypeError` at import and `uvicorn app.main:app` would not start. Fixed with `from __future__ import annotations` (no behaviour change). Backend owner please review.

Not exercised against the live backend: non-empty `active_alerts` (the seeded data has none) and a genuinely `STALE` overview (needs ~30 min without new telemetry); both are covered by unit tests only.
Station-level assets with `building_id: null` (the weather station) are not linked to any 3D object and are not displayed.
