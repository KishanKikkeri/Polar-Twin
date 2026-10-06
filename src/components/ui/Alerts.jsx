import { motion, AnimatePresence } from 'framer-motion'
import { Chip, ProvenanceChip } from './DataBadges.jsx'
import { formatUtc } from '../../services/twin/freshness.js'

const LEVEL_STYLE = {
  warn: { icon: '⚠', color: 'text-status-warn', border: 'border-status-warn/40' },
  normal: { icon: '✓', color: 'text-status-normal', border: 'border-status-normal/40' },
  critical: { icon: '⛔', color: 'text-status-critical', border: 'border-status-critical/40' },
}

// `alerts` are already adapted (adaptBackendAlert / adaptLocalAlert):
// { id, level, severity, title, message, objectId, origin, ... }.
// `origin` says where they came from; `provenance` is the backend overview's.
export default function Alerts({ open, alerts, origin, provenance, objects, onClose, onGoTo }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute top-44 right-3 z-40 w-72 max-h-[60vh] overflow-y-auto glass glow-border rounded-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-ice-300/60">Alerts</span>
            <button onClick={onClose} className="text-ice-300/50 hover:text-ice-100 text-xs">✕</button>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {origin === 'backend' ? (
              <>
                <Chip tone="normal">BACKEND</Chip>
                <ProvenanceChip provenance={provenance} />
              </>
            ) : (
              <Chip tone="simulated" title="Hard-coded demo alerts; the backend is not providing alerts">SIMULATED DEMO ALERTS</Chip>
            )}
          </div>

          <div className="space-y-2">
            {alerts.length === 0 && (
              <div className="text-[11px] text-ice-300/50 px-1 py-2">No active alerts reported by the backend.</div>
            )}
            {alerts.map((a) => {
              const style = LEVEL_STYLE[a.level] || LEVEL_STYLE.warn
              const obj = a.objectId ? objects.find((o) => o.id === a.objectId) : null
              return (
                <button
                  key={a.id}
                  onClick={() => obj && onGoTo(obj)}
                  disabled={!obj}
                  className={`w-full text-left rounded-lg border ${style.border} bg-white/[0.03] px-3 py-2 transition-colors ${obj ? 'hover:bg-white/[0.06]' : 'cursor-default'}`}
                >
                  <div className={`text-xs font-semibold flex items-center gap-1.5 ${style.color}`}>
                    <span>{style.icon}</span>
                    <span className="flex-1">{a.title}</span>
                    {a.severity && <span className="text-[9px] opacity-80">{a.severity}</span>}
                  </div>
                  {a.message && <div className="text-[11px] text-ice-300/60 mt-0.5">{a.message}</div>}
                  {a.recommendedAction && <div className="text-[11px] text-ice-300/70 mt-0.5">Action: {a.recommendedAction}</div>}
                  {(a.createdAt || a.source) && (
                    <div className="text-[10px] text-ice-300/40 mt-0.5">
                      {a.source}{a.source && a.createdAt ? ' · ' : ''}{a.createdAt ? formatUtc(a.createdAt) : ''}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
