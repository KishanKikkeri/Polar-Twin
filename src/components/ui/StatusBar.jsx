import { ConnectionDot, FreshnessChip, ProvenanceChip, Chip, toneText } from './DataBadges.jsx'

// Bottom status pill. The headline comes from the backend overview
// (provenance + freshness aware); it never asserts "all systems operational"
// without current backend data. TEMP/WIND/VISIBILITY come from the LOCAL
// demo simulator and are always tagged SIMULATED.
export default function StatusBar({ live, view }) {
  const { connection, overview, headline } = view
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center px-4 py-2.5 pointer-events-none">
      <div className="pointer-events-auto glass rounded-full px-5 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-ice-300/70">
        <span className="flex items-center gap-1.5">
          <ConnectionDot connection={connection} />
          <span className="text-ice-100 font-medium" title={connection.detail}>{connection.label}</span>
        </span>
        <span className="w-px h-3 bg-white/10 hidden sm:block" />
        <span className={`font-medium ${toneText(headline.tone)}`} title={headline.reason}>{headline.label}</span>
        {overview && (
          <>
            <ProvenanceChip provenance={overview.provenance} />
            <FreshnessChip freshness={overview.freshness} />
            <span className="hidden md:inline">UPDATED <b className="text-ice-100 tick">{overview.lastUpdatedUtc}</b></span>
          </>
        )}
        <span className="w-px h-3 bg-white/10 hidden sm:block" />
        <Chip tone="simulated" title="Environment readings below come from the local demo simulator, not the backend">SIMULATED</Chip>
        <span>TEMP <b className="text-ice-100 tick">{live.outsideTempC.toFixed(1)}°C</b></span>
        <span>WIND <b className="text-ice-100 tick">{live.windKmh.toFixed(0)} km/h</b></span>
        <span className="hidden sm:inline">VISIBILITY <b className="text-ice-100 tick">{live.visibilityKm.toFixed(1)} km</b></span>
      </div>
    </div>
  )
}
