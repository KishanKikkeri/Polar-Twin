import { KpiCard, ProgressBar, StatusDot } from '../DashboardPanel.jsx'

export default function WastePanel({ data }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.status} />
        <span className="text-status-normal font-medium">{data.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Generated Today" value={data.generatedTodayKg} unit="kg" />
        <KpiCard label="Processed Today" value={data.processedTodayKg} unit="kg" />
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Storage Capacity Used</span>
          <span className="tick text-ice-100">{data.storageCapacityPct}%</span>
        </div>
        <ProgressBar pct={data.storageCapacityPct} color="#4ade80" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center justify-between">
          <span className="text-ice-300/60">Incinerator</span>
          <span className="text-ice-300/80 text-right">{data.incineratorStatus}</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center justify-between">
          <span className="text-ice-300/60">Recycling</span>
          <span className="text-ice-300/80">{data.recyclingStatus}</span>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-ice-300/70 leading-relaxed">
        Antarctic Treaty rules require all waste to be segregated, and
        either processed on-site where permitted or shipped back to India.
      </div>
    </div>
  )
}
