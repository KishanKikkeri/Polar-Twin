import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Search({ open, onClose, onSelect, objects }) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return objects
    return objects.filter(
      (o) => o.name.toLowerCase().includes(q) || o.subtitle?.toLowerCase().includes(q) || o.type.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/50 flex items-start justify-center pt-24"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="glass glow-border rounded-2xl w-[440px] max-w-[92vw] max-h-[70vh] overflow-hidden flex flex-col"
          >
            <div className="p-3 border-b border-white/10 flex items-center gap-2">
              <span className="text-ice-300/60">🔍</span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Maitri infrastructure…"
                className="bg-transparent flex-1 outline-none text-sm text-ice-100 placeholder:text-ice-300/40"
              />
              <button onClick={onClose} className="text-ice-300/50 hover:text-ice-100 text-xs">ESC</button>
            </div>
            <div className="overflow-y-auto">
              {results.length === 0 && (
                <div className="p-4 text-xs text-ice-300/50">No matching infrastructure.</div>
              )}
              {results.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    onSelect(o)
                    onClose()
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors flex items-center gap-3 border-b border-white/5 last:border-b-0"
                >
                  <span className="text-lg">{o.icon}</span>
                  <div>
                    <div className="text-sm text-ice-100">{o.name}</div>
                    <div className="text-[11px] text-ice-300/50">{o.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
