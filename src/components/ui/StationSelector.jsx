import { motion } from 'framer-motion'
import { stationList } from '../../data/stations/index.js'

export default function StationSelector({ onSelect }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0 z-40 bg-ink-950 flex flex-col items-center justify-center px-4"
    >
      <div className="text-center mb-10">
        <div className="font-display text-3xl font-semibold tracking-wide text-ice-100">POLARTWIN</div>
        <div className="text-xs text-ice-300/50 mt-2 tracking-[0.2em] uppercase">Select Research Station</div>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {stationList.map((s, i) => (
          <motion.button
            key={s.id}
            onClick={() => onSelect(s.id)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 * i, duration: 0.4 }}
            whileHover={{ scale: 1.035 }}
            whileTap={{ scale: 0.98 }}
            className="group relative w-72 rounded-2xl overflow-hidden glass glow-border text-left"
          >
            <div className="h-40 w-full overflow-hidden">
              <img
                src={s.thumbnail}
                alt={s.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/10 to-transparent" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-4">
              <div className="font-display text-lg font-semibold tracking-wide text-ice-100 group-hover:text-ice-accent transition-colors">
                {s.shortName.toUpperCase()}
              </div>
              <div className="text-[11px] text-ice-300/70">{s.location}</div>
            </div>
            <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-ice-100 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              →
            </div>
          </motion.button>
        ))}
      </div>

      <div className="mt-10 text-[11px] text-ice-300/40 max-w-md text-center leading-relaxed">
        SIH26060 · Digital Platform for efficient remote management of Indian
        Antarctic Research Stations
      </div>
    </motion.div>
  )
}
