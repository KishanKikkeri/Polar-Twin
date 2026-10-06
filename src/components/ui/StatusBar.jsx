function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour12: false })
}

export default function StatusBar({ live }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center px-4 py-2.5 pointer-events-none">
      <div className="pointer-events-auto glass rounded-full px-5 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-ice-300/70">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-status-normal blink-dot" />
          <span className="text-ice-100 font-medium">ALL SYSTEMS OPERATIONAL</span>
        </span>
        <span className="w-px h-3 bg-white/10 hidden sm:block" />
        <span>TEMP <b className="text-ice-100 tick">{live.outsideTempC.toFixed(1)}°C</b></span>
        <span>WIND <b className="text-ice-100 tick">{live.windKmh.toFixed(0)} km/h</b></span>
        <span className="hidden sm:inline">VISIBILITY <b className="text-ice-100 tick">{live.visibilityKm.toFixed(1)} km</b></span>
        <span className="hidden md:inline">UPDATED <b className="text-ice-100 tick">{fmtTime(live.lastUpdate)}</b></span>
      </div>
    </div>
  )
}
