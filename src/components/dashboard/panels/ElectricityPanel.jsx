import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { KpiCard, ProgressBar, RangeTabs, StatusDot } from '../DashboardPanel.jsx'

export default function ElectricityPanel({ data, live }) {
  const [range, setRange] = useState('Today')
  const RANGES = { Today: data.hourly, '7 Days': data.daily, '12 Months': data.monthly }
  const series = RANGES[range]
  const load = live?.electricityLoadKw ?? data.base.currentLoadKw
  const todayKwh = live?.electricityKwhToday ?? data.base.todayKwh

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.base.status} />
        <span className="text-status-normal font-medium">{data.base.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-ice-300/60 mb-1">
          <span>Current Load</span>
          <span className="tick text-ice-100">{load.toFixed(1)} kW</span>
        </div>
        <ProgressBar pct={(load / data.base.peakLoadKw) * 100} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Today" value={todayKwh.toFixed(0)} unit="kWh" />
        <KpiCard label="This Week" value={data.base.weekKwh.toLocaleString()} unit="kWh" />
        <KpiCard label="This Month" value={data.base.monthKwh.toLocaleString()} unit="kWh" />
        <KpiCard label="Peak Load" value={data.base.peakLoadKw} unit="kW" />
        <KpiCard label="Efficiency" value={data.base.efficiency} unit="%" />
        <KpiCard label="Voltage / Freq" value={`${data.base.voltage}V`} sub={`${data.base.frequency} Hz`} />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-ice-300/50">Consumption</div>
        <RangeTabs options={Object.keys(RANGES)} value={range} onChange={setRange} />
      </div>

      <div className="h-40 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <defs>
              <linearGradient id="elecGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#0a0f16', border: '1px solid rgba(159,212,234,0.2)', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="value" stroke="#fbbf24" fill="url(#elecGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-ice-300/50 mb-2">Generators</div>
        <div className="space-y-1.5">
          {data.base.generators.map((g) => (
            <div key={g.id} className="flex items-center justify-between text-xs bg-white/[0.03] rounded-md px-2.5 py-1.5">
              <span className="flex items-center gap-2"><StatusDot status={g.status} />{g.id}</span>
              <span className="text-ice-300/70">{g.status} {g.load ? `· ${g.load}%` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
