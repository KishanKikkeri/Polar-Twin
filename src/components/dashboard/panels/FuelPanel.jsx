import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { KpiCard, RangeTabs, StatusDot } from '../DashboardPanel.jsx'

export default function FuelPanel({ data, live }) {
  const [range, setRange] = useState('7 Days')
  const RANGES = { '7 Days': data.weekly, '12 Months': data.monthly }
  const series = RANGES[range]
  const pct = live?.fuelPct ?? Number(((data.base.currentLevelKl / data.base.tankCapacityKl) * 100).toFixed(1))
  const remainingDays = Math.round(data.base.currentLevelKl / data.base.consumptionRateKlPerDay)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.base.status} />
        <span className="text-status-normal font-medium">{data.base.status}</span>
        <span className="text-ice-300/40">· simulated data</span>
      </div>

      <div className="flex items-end gap-4">
        <div className="relative w-14 h-28 rounded-md border border-white/15 bg-white/[0.03] overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-orange-400 to-amber-300 transition-all duration-700"
            style={{ height: `${pct}%` }}
          />
        </div>
        <div>
          <div className="text-2xl font-display font-semibold text-ice-100 tick">{pct}%</div>
          <div className="text-xs text-ice-300/60">{data.base.currentLevelKl.toLocaleString()} kL of {data.base.tankCapacityKl.toLocaleString()} kL</div>
          <div className="text-xs text-ice-300/50 mt-1">~{remainingDays} days remaining at current rate</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="Today's Usage" value={data.base.todayUsageKl} unit="kL" />
        <KpiCard label="Weekly Usage" value={data.base.weekUsageKl} unit="kL" />
        <KpiCard label="Monthly Usage" value={data.base.monthUsageKl} unit="kL" />
        <KpiCard label="Consumption Rate" value={data.base.consumptionRateKlPerDay} unit="kL/day" />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-ice-300/50">Usage Trend</div>
        <RangeTabs options={Object.keys(RANGES)} value={range} onChange={setRange} />
      </div>
      <div className="h-40 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9fd4ea', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#0a0f16', border: '1px solid rgba(159,212,234,0.2)', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" fill="#fb923c" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-ice-300/50 mb-2">Tank Status</div>
        <div className="space-y-1.5">
          {data.base.tanks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <span className="w-16 text-ice-300/70">{t.id}</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${t.pct}%` }} />
              </div>
              <span className="w-8 text-right text-ice-300/70">{t.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
