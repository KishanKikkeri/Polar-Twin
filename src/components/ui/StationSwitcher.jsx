import { motion } from 'framer-motion'
import { stationList } from '../../data/stations/index.js'

// Floating control shown while inside a station's map/3D view, letting the
// user hop to the other configured station without leaving the app or
// reloading the page.
export default function StationSwitcher({ currentId, onSwitch }) {
  const other = stationList.find((s) => s.id !== currentId)
  if (!other) return null

  return (
    <motion.button
      onClick={() => onSwitch(other.id)}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="absolute bottom-16 left-3 z-30 glass glow-border rounded-xl overflow-hidden flex items-center gap-2.5 pr-3 group"
    >
      <img src={other.thumbnail} alt={other.name} className="w-11 h-11 object-cover" />
      <div className="text-left py-1.5">
        <div className="text-[9px] uppercase tracking-wide text-ice-300/50">Switch Station</div>
        <div className="text-xs font-semibold text-ice-100 group-hover:text-ice-accent transition-colors">{other.shortName}</div>
      </div>
    </motion.button>
  )
}
