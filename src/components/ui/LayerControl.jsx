import { motion, AnimatePresence } from 'framer-motion'

const LAYER_LABELS = [
  { key: 'buildings', label: 'Buildings & Terrain' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'water', label: 'Water' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'heating', label: 'Heating' },
  { key: 'communication', label: 'Communication' },
  { key: 'waste', label: 'Waste' },
  { key: 'roads', label: 'Roads & Pads' },
]

export default function LayerControl({ open, layers, onToggle, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute top-44 right-3 z-40 w-56 glass glow-border rounded-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-ice-300/60">Layers</span>
            <button onClick={onClose} className="text-ice-300/50 hover:text-ice-100 text-xs">✕</button>
          </div>
          <div className="space-y-1.5">
            {LAYER_LABELS.map((l) => (
              <label key={l.key} className="flex items-center gap-2 text-xs text-ice-100/90 cursor-pointer hover:text-ice-100">
                <input
                  type="checkbox"
                  checked={layers[l.key] !== false}
                  onChange={() => onToggle(l.key)}
                  className="accent-[#3fd7ff] w-3.5 h-3.5"
                />
                {l.label}
              </label>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
