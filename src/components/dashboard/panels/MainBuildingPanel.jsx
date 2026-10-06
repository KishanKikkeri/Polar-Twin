import { KpiCard, ProgressBar, StatusDot } from '../DashboardPanel.jsx'

export default function MainBuildingPanel({ data }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.status} />
        <span className="text-status-normal font-medium">{data.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Occupancy" value={data.occupancy} unit="people" />
        <KpiCard label="Electricity" value={data.electricityKw} unit="kW" />
        <KpiCard label="Water Use" value={data.waterL} unit="L" />
        <KpiCard label="Temperature" value={data.temperatureC} unit="°C" />
        <KpiCard label="Air Quality" value={data.airQuality} />
        <KpiCard label="Emergency" value={data.emergencyStatus} />
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Heating Load</span>
          <span className="tick text-ice-100">{data.heatingLoadPct}%</span>
        </div>
        <ProgressBar pct={data.heatingLoadPct} color="#f87171" />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-ice-300/70 leading-relaxed">
        Aggregated metrics roll up electricity, heating and water drawn by
        this structure.
      </div>
    </div>
  )
}
