import { ConnectionDot, Chip, ProvenanceChip } from './DataBadges.jsx'

export default function TopBar({
  stationName,
  showStationTools,
  viewMode,
  onSearchOpen,
  onLayersOpen,
  onInfoOpen,
  onAlertsOpen,
  onMapViewToggle,
  onCopilotOpen,
  onWhatIfOpen,
  onReplayOpen,
  onEmergencyOpen,
  onCompareOpen,
  onIntelligenceOpen,
  alertCount,
  connection,
  provenance,
  backendHealth,
  onRefresh,
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
        {/* Operator Engines Suite */}
        <div className="glass rounded-xl p-1 flex items-center gap-1 border border-ice-accent/25 shadow-lg">
          <button
            onClick={onCopilotOpen}
            title="AI Operator Copilot (Grounded Chat & Context)"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-cyan-300 hover:text-white hover:bg-cyan-500/20 transition-all flex items-center gap-1.5"
          >
            <span>🤖</span>
            <span className="hidden xl:inline font-semibold">Copilot</span>
          </button>
          <button
            onClick={onWhatIfOpen}
            title="What-If Causal Simulator (Stress Test & Blackout Risk)"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-amber-300 hover:text-white hover:bg-amber-500/20 transition-all flex items-center gap-1.5"
          >
            <span>⚡</span>
            <span className="hidden xl:inline font-semibold">What-If</span>
          </button>
          <button
            onClick={onReplayOpen}
            title="Historical Telemetry Replay & Event Scrubbing"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-blue-300 hover:text-white hover:bg-blue-500/20 transition-all flex items-center gap-1.5"
          >
            <span>⏪</span>
            <span className="hidden xl:inline font-semibold">Replay</span>
          </button>
          <button
            onClick={onEmergencyOpen}
            title="Emergency Mode & Ranked Load Shedding Dispatch"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-red-300 bg-red-950/40 border border-red-500/30 hover:bg-red-900/50 hover:text-white transition-all flex items-center gap-1.5 animate-pulse"
          >
            <span>🚨</span>
            <span className="hidden xl:inline font-semibold">Emergency</span>
          </button>
          <button
            onClick={onCompareOpen}
            title="Dual-Station Twin Comparison (Maitri vs Bharati)"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-indigo-300 hover:text-white hover:bg-indigo-500/20 transition-all flex items-center gap-1.5"
          >
            <span>⚖</span>
            <span className="hidden xl:inline font-semibold">Compare</span>
          </button>
          <button
            onClick={() => onIntelligenceOpen?.('forecast')}
            title="4B Intelligence Engines (Forecasts, Anomalies, Maintenance, Risk, Recommendations)"
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-purple-300 hover:text-white hover:bg-purple-500/20 transition-all flex items-center gap-1.5"
          >
            <span>🧠</span>
            <span className="hidden xl:inline font-semibold">Intelligence</span>
          </button>
        </div>

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
        {backendHealth && (
          <div
            className="glass rounded-lg px-2.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer hover:border-ice-accent/40 transition-colors"
            title={`Backend Health: ${backendHealth.status.toUpperCase()}${backendHealth.latencyMs != null ? ` (${backendHealth.latencyMs}ms)` : ''}${backendHealth.health?.database ? ` · Database: ${backendHealth.health.database.status}` : ''}${backendHealth.health?.version ? ` · v${backendHealth.health.version}` : ''}`}
            onClick={onInfoOpen}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                backendHealth.status === 'ok'
                  ? 'bg-status-good shadow-[0_0_8px_rgba(74,222,128,0.6)]'
                  : backendHealth.status === 'checking'
                  ? 'bg-ice-accent animate-pulse'
                  : 'bg-status-warn shadow-[0_0_8px_rgba(251,146,60,0.6)]'
              }`}
            />
            <span className="text-[11px] font-mono text-ice-200 hidden lg:inline">
              {backendHealth.status === 'ok'
                ? `HEALTH: OK${backendHealth.latencyMs != null ? ` · ${backendHealth.latencyMs}ms` : ''}`
                : backendHealth.status === 'checking'
                ? 'HEALTH: …'
                : 'HEALTH: DOWN'}
            </span>
          </div>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh Digital Twin data from backend"
            className="glass rounded-lg px-2.5 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors flex items-center gap-1"
          >
            🔄 <span className="hidden xl:inline">Sync</span>
          </button>
        )}
        <button
          onClick={onInfoOpen}
          className="glass rounded-lg px-3 py-2 text-xs text-ice-300/80 hover:text-ice-100 hover:border-ice-accent/40 transition-colors"
        >
          ⓘ
        </button>
        <div className="glass rounded-lg px-3 py-2 text-xs flex items-center gap-2" title={connection.detail}>
          <ConnectionDot connection={connection} />
          <span className="text-ice-100 hidden md:inline">{connection.label}</span>
        </div>
        <div className="glass rounded-lg px-3 py-2 hidden lg:flex items-center">
          {provenance ? (
            <ProvenanceChip provenance={provenance} />
          ) : (
            <Chip tone="simulated" title="No backend data: the local demo simulation is displayed">SIMULATED</Chip>
          )}
        </div>
      </div>
    </div>
  )
}
