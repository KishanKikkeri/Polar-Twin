function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function WeatherWidget({ stationName, weather }) {
  const { loading, error, data } = weather

  if (loading && !data) {
    return (
      <div className="absolute top-16 right-3 z-20 glass glow-border rounded-xl px-3 py-2.5 w-[190px] text-xs text-ice-300/60">
        Loading weather…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="absolute top-16 right-3 z-20 glass glow-border rounded-xl px-3 py-2.5 w-[190px] text-xs text-status-warn">
        WEATHER DATA UNAVAILABLE
      </div>
    )
  }

  const isLive = data.source === 'live'

  return (
    <div className="absolute top-16 right-3 z-20 glass glow-border rounded-xl px-3 py-2.5 w-[190px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-ice-300/50">{stationName} Weather</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-display font-semibold text-ice-100 tick">
          {data.tempC != null ? Math.round(data.tempC) : '—'}°C
        </span>
        <span className="text-[11px] text-ice-300/60">{data.condition}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-[11px] text-ice-300/60">
        <div className="flex justify-between"><span>Feels like</span><span className="text-ice-100">{data.feelsLikeC != null ? Math.round(data.feelsLikeC) : '—'}°C</span></div>
        <div className="flex justify-between"><span>Humidity</span><span className="text-ice-100">{data.humidity ?? '—'}%</span></div>
        <div className="flex justify-between"><span>Wind</span><span className="text-ice-100">{data.windKmh ?? '—'} km/h</span></div>
        <div className="flex justify-between"><span>Visibility</span><span className="text-ice-100">{data.visibilityKm ?? '—'} km</span></div>
      </div>
      <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px]">
        <span className={`flex items-center gap-1 ${isLive ? 'text-status-normal' : 'text-status-warn'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-status-normal' : 'bg-status-warn'} blink-dot`} />
          {isLive ? 'LIVE WEATHER' : 'SIMULATED'}
        </span>
        <span className="text-ice-300/40">Upd. {fmtTime(data.fetchedAt)}</span>
      </div>
      {error && !isLive && (
        <div className="mt-1 text-[10px] text-ice-300/40">API unavailable — showing fallback</div>
      )}
    </div>
  )
}
