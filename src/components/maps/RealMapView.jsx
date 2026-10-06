import { useState } from 'react'
import { motion } from 'framer-motion'

export default function RealMapView({ meta, onEnter3D }) {
  const [imgError, setImgError] = useState(false)

  return (
    <motion.div
      key="map"
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0 flex items-center justify-center bg-ink-950 overflow-hidden"
    >
      {/* subtle GIS-style corner ticks + grid to make this feel like a map
          viewer rather than a plain <img> on a page */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(159,212,234,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(159,212,234,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative w-full h-full flex items-center justify-center p-8 pt-24 pb-16">
        {!imgError ? (
          <img
            src={meta.mapImage}
            alt={`${meta.name} reference map`}
            onError={() => setImgError(true)}
            className="max-w-full max-h-full object-contain rounded-xl shadow-glow border border-white/10"
          />
        ) : (
          <div className="max-w-lg text-center text-ice-300/50 text-sm p-8 border border-white/10 rounded-xl">
            Map image unavailable. Add a reference image at
            <code className="block mt-2 text-ice-accent text-xs">{meta.mapImage}</code>
          </div>
        )}
      </div>

      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-[11px] text-ice-300/40 max-w-md text-center px-4">
        {meta.mapAttribution}
      </div>

      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={onEnter3D}
        className="absolute right-6 top-1/2 -translate-y-1/2 glass glow-border rounded-xl px-5 py-4 flex flex-col items-center gap-1 text-ice-100"
      >
        <span className="text-2xl">🧊</span>
        <span className="text-xs font-semibold tracking-wide">ENTER 3D</span>
        <span className="text-[10px] text-ice-300/60">DIGITAL TWIN</span>
      </motion.button>
    </motion.div>
  )
}
