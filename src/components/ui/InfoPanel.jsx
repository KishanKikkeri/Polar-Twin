import { motion, AnimatePresence } from 'framer-motion'

import { formatValue } from '../../services/twin/formatters.js'

export default function InfoPanel({ open, onClose, meta, backendStation, connection }) {
  if (!meta) return null
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            onClick={(e) => e.stopPropagation()}
            className="glass glow-border rounded-2xl w-[420px] max-w-[92vw] p-5 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ice-300/50">POLARTWIN</div>
                <h3 className="font-display text-lg font-semibold text-ice-100">{meta.name}</h3>
                <div className="text-[11px] text-ice-accent mt-0.5">SIH26060 · Ministry of Earth Sciences (MoES) · Disaster Management</div>
              </div>
              <button onClick={onClose} className="text-ice-300/50 hover:text-ice-100 text-xs">✕</button>
            </div>
            <div className="text-xs text-ice-300/70 mb-4 leading-relaxed">
              Smart India Hackathon 2026 problem statement: "Digital Platform
              for efficient remote management of Indian Antarctic Research
              Stations." POLARTWIN is the 3D monitoring layer of that
              platform, covering both of India's active Antarctic stations.
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Location</dt>
                <dd className="text-ice-100">{meta.location}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Coordinates (station config)</dt>
                <dd className="text-ice-100 tick">{meta.coords.lat.toFixed(4)}°, {meta.coords.lon.toFixed(4)}°</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Backend station record</dt>
                {backendStation ? (
                  <dd className="text-ice-100 text-xs space-y-0.5">
                    <div>Status: <b>{formatValue(backendStation.status).toUpperCase()}</b></div>
                    <div>Latitude / longitude: {formatValue(backendStation.latitude)} / {formatValue(backendStation.longitude)}</div>
                    <div>Elevation: {formatValue(backendStation.elevation, { unit: 'm' })}</div>
                  </dd>
                ) : (
                  <dd className="text-status-warn text-xs">
                    Unavailable{connection ? ` — ${connection.label}` : ''}. Station metadata shown here comes from the local configuration.
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Operator</dt>
                <dd className="text-ice-100">{meta.operator}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Established</dt>
                <dd className="text-ice-100">{meta.established}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ice-300/50">Purpose</dt>
                <dd className="text-ice-300/80 leading-relaxed">{meta.purpose}</dd>
              </div>
            </dl>
            <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-ice-300/50 leading-relaxed">
              This digital twin is a visual prototype. Weather comes from the
              OpenWeather API when a key is configured. The station overview
              comes from the POLARTWIN backend when it is reachable and is
              labelled with the provenance the backend reports (e.g.
              SIMULATED or REAL OBSERVATION). Per-system figures — power,
              fuel, water, occupancy and similar readings — come from a local
              demo simulator and are labelled SIMULATED; they are not a live
              station sensor feed.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
