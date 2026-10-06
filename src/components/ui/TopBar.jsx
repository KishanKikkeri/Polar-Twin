export default function TopBar({
  stationName,
  showStationTools,
  viewMode,
  onSearchOpen,
  onLayersOpen,
  onInfoOpen,
  onAlertsOpen,
  onMapViewToggle,
  alertCount,
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-5 py-3 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg glass glow-border flex items-center justify-center font-display font-bold text-ice-accent">P</div>
        <div>
          <div className="font-display text-sm font-semibold tracking-wide text-ice-100 leading-tight">
            POLARTWIN{stationName ? <span className="text-ice-accent"> · {stationName}</span> : null}
          </div>
          <div className="text-[10px] text-ice-300/60 leading-tight">SIH26060 · Remote Management of Antarctic Research Stations</div>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        {showStationTools && (
          <>
            <button
              onClick={onMapViewToggle}
              className="glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors flex items-center gap-2"
            >
              {viewMode === '3d' ? '🗺 MAP VIEW' : '🧊 3D VIEW'}
            </button>
            <button
              onClick={onSearchOpen}
              className="glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors flex items-center gap-2"
            >
              🔍 <span className="hidden sm:inline">Search</span>
            </button>
            <button
              onClick={onLayersOpen}
              className="glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors flex items-center gap-2"
            >
              ▤ <span className="hidden sm:inline">Layers</span>
            </button>
            <button
              onClick={onAlertsOpen}
              className="relative glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors flex items-center gap-2"
            >
              ⚠ <span className="hidden sm:inline">Alerts</span>
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-status-warn text-ink-950 text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>
          </>
        )}
        <button
          onClick={onInfoOpen}
          className="glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors"
        >
          ⓘ
        </button>
        <div className="glass rounded-lg px-3 py-2 text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-status-normal blink-dot" />
          <span className="text-ice-100 hidden md:inline">SYSTEM ONLINE</span>
        </div>
        <div className="glass rounded-lg px-3 py-2 text-[10px] text-ice-accent hidden lg:flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-ice-accent blink-dot" /> LIVE SIMULATION
        </div>
      </div>
    </div>
  )
}
