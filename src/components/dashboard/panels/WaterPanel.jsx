import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { KpiCard, ProgressBar, StatusDot } from '../DashboardPanel.jsx'

export default function WaterPanel({ data, live }) {
  const pct = live?.waterPct ?? data.base.tankLevelPct

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.base.status} />
        <span className="text-status-normal font-medium">{data.base.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Tank Level</span>
          <span className="tick text-ice-100">{pct.toFixed ? pct.toFixed(1) : pct}%</span>
        </div>
        <ProgressBar pct={pct} color="#38bdf8" />
      </div>

      <div className="relative h-10 rounded-md overflow-hidden border border-white/10 bg-white/[0.03] flex items-center">
        <div className="w-full h-2 relative overflow-hidden mx-3 rounded-full bg-white/10">
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-sky-300 to-transparent animate-[flow_1.8s_linear_infinite]" />
        </div>
        <style>{`@keyframes flow { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }`}</style>
        <span className="absolute right-3 text-[11px] text-ice-300/60">{data.base.flowRateLpm} L/min</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Today" value={data.base.todayL.toLocaleString()} unit="L" />
        <KpiCard label="This Week" value={data.base.weekL.toLocaleString()} unit="L" />
        <KpiCard label="This Month" value={data.base.monthL.toLocaleString()} unit="L" />
        <KpiCard label="Storage Capacity" value={(data.base.storageCapacityL / 1000).toFixed(0)} unit="kL" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center justify-between">
          <span className="text-ice-300/60">Pump</span>
          <span className="flex items-center gap-1.5"><StatusDot status={data.base.pumpStatus} />{data.base.pumpStatus}</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center justify-between">
          <span className="text-ice-300/60">Purification</span>
          <span className="flex items-center gap-1.5"><StatusDot status={data.base.purificationStatus} />{data.base.purificationStatus}</span>
        </div>
      </div>

      <div className="text-xs uppercase tracking-wide text-ice-300/50">Daily Consumption</div>
      <div className="h-40 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.daily}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#0a0f16', border: '1px solid rgba(159,212,234,0.2)', borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
