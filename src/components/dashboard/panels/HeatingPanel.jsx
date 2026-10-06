import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { KpiCard, ProgressBar, StatusDot } from '../DashboardPanel.jsx'

export default function HeatingPanel({ data, live }) {
  const loadPct = live?.heatingLoadPct ?? data.base.loadPct

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.base.status} />
        <span className="text-status-normal font-medium">{data.base.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Current Temp" value={data.base.currentTempC} unit="°C" />
        <KpiCard label="Target Temp" value={data.base.targetTempC} unit="°C" />
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Heating Load</span>
          <span className="tick text-ice-100">{loadPct.toFixed ? loadPct.toFixed(1) : loadPct}%</span>
        </div>
        <ProgressBar pct={loadPct} color="#f87171" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Fuel Used Today" value={data.base.fuelUsedTodayKl} unit="kL" />
        <KpiCard label="Efficiency" value={data.base.efficiency} unit="%" />
        <KpiCard label="Rooms Heated" value={data.base.roomsHeated} />
        <KpiCard label="System" value={data.base.systemStatus} />
      </div>

      <div className="text-xs uppercase tracking-wide text-ice-300/50">Indoor vs Outdoor Temperature</div>
      <div className="h-44 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.trend}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#0a0f16', border: '1px solid rgba(159,212,234,0.2)', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="tempC" name="Indoor °C" stroke="#f87171" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="outsideC" name="Outside °C" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
