import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import StationScene from './components/3d/StationScene.jsx'
import RealMapView from './components/maps/RealMapView.jsx'
import TopBar from './components/ui/TopBar.jsx'
import StatusBar from './components/ui/StatusBar.jsx'
import LayerControl from './components/ui/LayerControl.jsx'
import Search from './components/ui/Search.jsx'
import Alerts from './components/ui/Alerts.jsx'
import OverviewButton from './components/ui/OverviewButton.jsx'
import MiniMap from './components/ui/MiniMap.jsx'
import LoadingScreen from './components/ui/LoadingScreen.jsx'
import InfoPanel from './components/ui/InfoPanel.jsx'
import StationSelector from './components/ui/StationSelector.jsx'
import StationSwitcher from './components/ui/StationSwitcher.jsx'
import WeatherWidget from './components/weather/WeatherWidget.jsx'
import DashboardPanel from './components/dashboard/DashboardPanel.jsx'
import AssetInspector from './components/dashboard/AssetInspector.jsx'
import StationOverviewCard from './components/ui/StationOverviewCard.jsx'
import { SimulatedBanner } from './components/ui/DataBadges.jsx'
import BlueprintHUD from './components/ui/BlueprintHUD.jsx'
import { getPanelComponent } from './hooks/useStationData.js'
import { useLiveData } from './hooks/useLiveData.js'
import { useStationWeather } from './hooks/useStationWeather.js'
import { useStationTwin } from './hooks/useStationTwin.js'
import { useBackendStations } from './hooks/useBackendStations.js'
import { useNow } from './hooks/useNow.js'
import { buildTwinView } from './services/twin/twinView.js'
import { groupAssetsByObject } from './services/twin/assetMapping.js'
import { getStation } from './data/stations/index.js'
import { getInfraBundle } from './data/infra/index.js'

export default function App() {
  const [phase, setPhase] = useState('loading') // loading | select | station
  const [activeStationId, setActiveStationId] = useState(null)
  const [viewMode, setViewMode] = useState('map') // map | 3d

  const [selectedId, setSelectedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [layers, setLayers] = useState({})
  const [layersOpen, setLayersOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const live = useLiveData()
  const station = activeStationId ? getStation(activeStationId) : null
  const weather = useStationWeather(activeStationId, station?.meta.coords)

  // Backend integration. The local station config still drives the 3D scene;
  // the backend supplies status/overview/assets. Anything not coming from the
  // backend is shown from local simulation and labelled as such.
  const backendStations = useBackendStations()
  const { twin, loading: twinLoading } = useStationTwin(activeStationId)
  const now = useNow(30000)
  const view = useMemo(
    () => buildTwinView(twin, { now, loading: twinLoading, localAlerts: station?.alerts || [] }),
    [twin, now, twinLoading, station]
  )
  const assetGroups = useMemo(
    () => (twin?.assets && station ? groupAssetsByObject(twin.assets, station.objects) : null),
    [twin, station]
  )

  const selected = useMemo(
    () => (station ? station.objects.find((o) => o.id === selectedId) || null : null),
    [station, selectedId]
  )
  const PanelComponent = selected ? getPanelComponent(selected.dashboardType) : null
  const panelData = selected && station ? getInfraBundle(station.meta.id, selected.dashboardType) : null

  const resetSelection = () => {
    setSelectedId(null)
    setHoveredId(null)
    setLayersOpen(false)
    setAlertsOpen(false)
    setSearchOpen(false)
  }

  const handleSelectStation = (id) => {
    setActiveStationId(id)
    setViewMode('map')
    resetSelection()
    setPhase('station')
  }

  const handleSwitchStation = (id) => {
    setActiveStationId(id)
    setViewMode('map')
    resetSelection()
  }

  const handleSelectObject = (obj) => {
    setSelectedId(obj.id)
    setViewMode('3d')
    setLayersOpen(false)
    setAlertsOpen(false)
  }

  const handleOverview = () => setSelectedId(null)

  const toggleLayer = (key) =>
    setLayers((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }))

  return (
    <div className="relative w-screen h-screen bg-ink-950 overflow-hidden font-body">
      {phase === 'loading' && <LoadingScreen onDone={() => setPhase('select')} />}

      {phase === 'select' && <StationSelector onSelect={handleSelectStation} backend={backendStations} />}

      {phase === 'station' && station && (
        <>
          <AnimatePresence mode="wait">
            {viewMode === 'map' ? (
              <RealMapView key="map" meta={station.meta} onEnter3D={() => setViewMode('3d')} />
            ) : (
              <motion.div
                key="3d"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0"
              >
                <StationScene
                  stationKey={station.meta.id}
                  objects={station.objects}
                  roadPaths={station.roadPaths}
                  terrain={station.terrain}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  onSelect={handleSelectObject}
                  onHoverStart={(o) => setHoveredId(o.id)}
                  onHoverEnd={() => setHoveredId(null)}
                  layers={layers}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {viewMode === '3d' && (
            <BlueprintHUD
              stationName={station.meta.shortName}
              objectCount={station.objects.length}
              dataLabel={view.badge.dataLabel}
              linkLabel={view.badge.linkLabel}
            />
          )}

          <TopBar
            stationName={station.meta.shortName}
            showStationTools={viewMode === '3d'}
            viewMode={viewMode}
            onSearchOpen={() => setSearchOpen(true)}
            onLayersOpen={() => setLayersOpen((v) => !v)}
            onInfoOpen={() => setInfoOpen(true)}
            onAlertsOpen={() => setAlertsOpen((v) => !v)}
            onMapViewToggle={() => setViewMode((v) => (v === '3d' ? 'map' : '3d'))}
            alertCount={view.alerts.filter((a) => a.level !== 'normal').length}
            connection={view.connection}
            provenance={view.overview?.provenance ?? null}
          />

          {!selected && (
            <StationOverviewCard
              view={view}
              loading={twinLoading}
              error={twin?.errors?.overview}
              defaultOpen={viewMode === 'map'}
            />
          )}

          <WeatherWidget stationName={station.meta.shortName} weather={weather} />

          {viewMode === '3d' && (
            <>
              <OverviewButton visible={!!selected} onClick={handleOverview} />
              <MiniMap selected={selected} objects={station.objects} stationName={station.meta.shortName} />
              <LayerControl open={layersOpen} layers={layers} onToggle={toggleLayer} onClose={() => setLayersOpen(false)} />
              <Alerts
                open={alertsOpen}
                alerts={view.alerts}
                origin={view.alertsOrigin}
                provenance={view.overview?.provenance ?? null}
                objects={station.objects}
                onClose={() => setAlertsOpen(false)}
                onGoTo={handleSelectObject}
              />
              <Search open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelectObject} objects={station.objects} />
              <DashboardPanel obj={selected} onClose={handleOverview}>
                <SimulatedBanner connection={view.connection} />
                <AssetInspector
                  status={twinLoading ? 'loading' : assetGroups ? 'ok' : 'unavailable'}
                  assets={assetGroups?.byObjectId[selected?.id] || []}
                  error={twin?.errors?.assets}
                  retained={Boolean(twin?.retained)}
                />
                {PanelComponent && panelData && <PanelComponent data={panelData} live={live} />}
              </DashboardPanel>
            </>
          )}

          <StationSwitcher currentId={station.meta.id} onSwitch={handleSwitchStation} />

          <StatusBar live={live} view={view} />
        </>
      )}

      <InfoPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        meta={station?.meta}
        backendStation={twin?.station ?? null}
        connection={view.connection}
      />
    </div>
  )
}
