import { KpiCard, StatusDot } from '../DashboardPanel.jsx'

export default function LaboratoryPanel({ data }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.status} />
        <span className="text-status-normal font-medium">{data.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Occupancy" value={data.occupancy} unit="people" />
        <KpiCard label="Active Equipment" value={data.activeEquipment} unit="units" />
        <KpiCard label="Electricity" value={data.electricityKw} unit="kW" />
        <KpiCard label="Temperature" value={data.temperatureC} unit="°C" />
        <KpiCard label="Humidity" value={data.humidityPct} unit="%" />
        <KpiCard label="Air Quality" value={data.airQuality} />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-ice-300/70 leading-relaxed">
        Supports the station's science mandate. Environmental sensors keep
        humidity and temperature within instrument tolerances year-round.
      </div>
    </div>
  )
}
