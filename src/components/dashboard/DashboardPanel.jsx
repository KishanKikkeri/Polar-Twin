import { motion, AnimatePresence } from 'framer-motion'

const STATUS_COLORS = {
  NORMAL: 'text-status-normal',
  ACTIVE: 'text-status-normal',
  RUNNING: 'text-status-normal',
  ONLINE: 'text-status-normal',
  STABLE: 'text-status-normal',
  GOOD: 'text-status-normal',
  CLEAR: 'text-status-normal',
  WARNING: 'text-status-warn',
  STANDBY: 'text-ice-300',
  CRITICAL: 'text-status-critical',
}

export function StatusDot({ status }) {
  const color =
    status === 'NORMAL' || status === 'ACTIVE' || status === 'RUNNING' || status === 'ONLINE' || status === 'STABLE' || status === 'GOOD' || status === 'CLEAR'
      ? 'bg-status-normal'
      : status === 'WARNING'
      ? 'bg-status-warn'
      : status === 'CRITICAL'
      ? 'bg-status-critical'
      : 'bg-ice-300'
  return <span className={`inline-block w-2 h-2 rounded-full ${color} blink-dot`} />
}

export function KpiCard({ label, value, unit, sub }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-ice-300/60">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-display font-semibold text-ice-100 tick">{value}</span>
        {unit && <span className="text-xs text-ice-300/70">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-ice-300/50 mt-0.5">{sub}</div>}
    </div>
  )
}

export function ProgressBar({ pct, color = '#3fd7ff' }) {
  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
      />
    </div>
  )
}

export function RangeTabs({ options, value, onChange }) {
  return (
    <div className="flex gap-1 bg-white/5 rounded-md p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2 py-1 text-[11px] rounded transition-colors ${
            value === opt ? 'bg-ice-accent/20 text-ice-accent' : 'text-ice-300/60 hover:text-ice-100'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function DashboardPanel({ obj, onClose, children }) {
  return (
    <AnimatePresence>
      {obj && (
        <motion.div
          initial={{ x: -420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -420, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 28 }}
          className="absolute left-3 top-16 bottom-3 w-[360px] max-w-[90vw] z-30 glass glow-border rounded-2xl overflow-y-auto"
        >
          <div className="p-4 border-b border-white/10 sticky top-0 glass z-10">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] tracking-wide text-ice-300/60">{obj.subtitle}</div>
                <h2 className="font-display text-xl font-semibold text-ice-100 flex items-center gap-2">
                  <span>{obj.icon}</span>{obj.name}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-ice-300/60 hover:text-ice-100 text-sm rounded-md px-2 py-1 hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="p-4 space-y-4">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
