import { motion, AnimatePresence } from 'framer-motion'

const LEVEL_STYLE = {
  warn: { icon: '⚠', color: 'text-status-warn', border: 'border-status-warn/40' },
  normal: { icon: '✓', color: 'text-status-normal', border: 'border-status-normal/40' },
  critical: { icon: '⛔', color: 'text-status-critical', border: 'border-status-critical/40' },
}

export default function Alerts({ open, alerts, objects, onClose, onGoTo }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute top-44 right-3 z-40 w-72 glass glow-border rounded-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-ice-300/60">Alerts</span>
            <button onClick={onClose} className="text-ice-300/50 hover:text-ice-100 text-xs">✕</button>
          </div>
          <div className="space-y-2">
            {alerts.map((a) => {
              const style = LEVEL_STYLE[a.level] || LEVEL_STYLE.normal
              const obj = objects.find((o) => o.id === a.objectId)
              return (
                <button
                  key={a.id}
                  onClick={() => obj && onGoTo(obj)}
                  className={`w-full text-left rounded-lg border ${style.border} bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06] transition-colors`}
                >
                  <div className={`text-xs font-semibold flex items-center gap-1.5 ${style.color}`}>
                    <span>{style.icon}</span>{a.title}
                  </div>
                  <div className="text-[11px] text-ice-300/60 mt-0.5">{a.message}</div>
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
