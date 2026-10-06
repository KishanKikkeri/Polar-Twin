# POLARTWIN

**Smart India Hackathon 2026 — Problem Statement SIH26060**
*"Digital Platform for efficient remote management of Indian Antarctic
Research Stations"* — Theme: Disaster Management · Sponsoring Ministry:
Ministry of Earth Sciences (MoES).

3D Digital Twin for Antarctic Research Stations. Built with React, Vite,
Three.js / React Three Fiber, Recharts, Framer Motion and Tailwind CSS.

## Run locally

```bash
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

### Optional: live weather

Copy `.env.example` to `.env` and add a free OpenWeather API key:

```
VITE_OPENWEATHER_API_KEY=your_key_here
```

Without a key, POLARTWIN shows clearly-labeled simulated weather instead of
crashing or blocking the rest of the app.

## What's new in this version

- **Renamed to POLARTWIN** everywhere (loading screen, top bar, info panel,
  metadata).
- **Two stations**: Maitri and Bharati, each with its own layout, real
  published coordinates, and its own simulated operational data — added
  through a small per-station config file, not a duplicated app.
- **Station selector** appears after loading; nothing opens automatically.
- **Station switcher** (bottom-left) lets you hop between Maitri and
  Bharati from inside either view without a page reload.
- **Real Map ↔ 3D Digital Twin** modes per station, with a smooth
  crossfade/scale transition and an "ENTER 3D" / "MAP VIEW" toggle in the
  top bar.
- **Unrestricted 360° orbit** — `OrbitControls` is never disabled, so you
  can rotate/zoom/pan the scene whether or not a building is selected or
  the dashboard is open.
- **OpenWeather integration** (`src/components/weather`) with an env-based
  API key, a 12-minute refresh cycle, per-station caching, and a graceful
  simulated fallback on any failure (missing key, timeout, non-200, etc).

## Project structure

```
src/
  components/
    3d/            StationScene, Terrain, Building, UtilityMarker, Road, CameraController
    dashboard/      DashboardPanel shell + per-type panels (electricity, fuel, water, ...)
    maps/           RealMapView (image map + Enter 3D button)
    weather/        WeatherWidget + weatherService (OpenWeather)
    ui/             TopBar, StatusBar, StationSelector, StationSwitcher,
                    LayerControl, Search, Alerts, OverviewButton, MiniMap,
                    LoadingScreen, InfoPanel
  data/
    stations/       maitri.js, bharati.js, index.js (registry)
    infra/          per-station simulated metrics (generate.js, index.js)
  hooks/            useLiveData, useStationWeather, useStationData (panel registry)
```

Adding a third station later means one new `src/data/stations/<name>.js`
file (layout + meta + alerts) plus one line in `src/data/stations/index.js`
— `StationScene`, the dashboard panels and all UI chrome are already
station-agnostic.

## How this maps to SIH26060

The PS asks for a digital platform that lets station operators and MoES
manage Antarctic stations remotely. This project addresses that with:

- A **single-pane 3D view per station** so a remote operator instantly sees
  the physical layout instead of a spreadsheet or text log, plus a **real
  map mode** for a familiar GIS-style overview before diving into 3D.
- **Per-system monitoring** (power, fuel, water, heating, waste,
  communication, lab, main building) for each station independently.
- **Live weather** for each station's actual coordinates, so operators see
  real conditions instead of a single fixed reading.
- An **alert system** surfacing problems proactively (abnormal fuel burn, a
  pump needing maintenance) — the disaster-prevention angle of the PS.
- A **data layer decoupled from the 3D/UI layer** (`src/data`,
  `src/hooks/useLiveData.js`, `src/components/weather`) specifically so it
  can be pointed at real telemetry/SCADA feeds instead of the simulator.

For the hackathon pitch: this build is the **visualization and monitoring
layer** of the platform. A full submission for SIH26060 would pair it with
a real backend/ingestion pipeline, role-based access (station vs. MoES-HQ),
and offline/low-bandwidth handling for Antarctica's limited satellite
link — worth calling out even if not fully built for the demo.

## Data disclaimer

All operational values — power, fuel, water, occupancy, temperature,
equipment status — are **simulated** for this prototype and clearly marked
as such in the UI. Weather is live via OpenWeather when a key is
configured, and simulated (also clearly marked) otherwise. Neither is a
live feed from actual Maitri/Bharati sensors.

## Maitri Blueprint HUD update

The 3D Maitri station now includes a sci-fi blueprint/HUD presentation inspired by the supplied reference image. The update keeps the existing interactive Three.js digital twin and adds:

- dense cyan wireframe construction lines on elevated buildings
- darker blue-tinted aerial ground imagery
- full-screen blueprint frame and scanline/vignette treatment
- Maitri title/status readout and coordinates
- infrastructure callouts for main, power, fuel, water and communications
- station overview/key infrastructure panels
- multi-level zoom presentation bar

Run with:

```bash
npm install
npm run dev
```

The HUD is decorative and does not block existing 3D orbit, selection, search, layers, alerts, or dashboard interactions.
# Polar-Twin
