import { KpiCard, ProgressBar, StatusDot } from '../DashboardPanel.jsx'

export default function CommunicationPanel({ data }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.status} />
        <span className="text-status-normal font-medium">{data.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Satellite Link" value={data.satelliteLink} />
        <KpiCard label="Network" value={data.networkStatus} />
        <KpiCard label="Bandwidth" value={data.bandwidthMbps} unit="Mbps" />
        <KpiCard label="Latency" value={data.latencyMs} unit="ms" />
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Uptime (30 days)</span>
          <span className="tick text-ice-100">{data.uptimePct}%</span>
        </div>
        <ProgressBar pct={data.uptimePct} color="#a78bfa" />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-ice-300/70 leading-relaxed">
        Satellite uplink connects the station to India's Antarctic programme
        network for voice, data and telemetry, with radio as local backup.
      </div>
    </div>
  )
}
