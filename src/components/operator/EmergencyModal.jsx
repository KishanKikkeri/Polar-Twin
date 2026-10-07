import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'

export default function EmergencyModal({ open, onClose, stationId = 'maitri' }) {
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sheddingAcknowledged, setSheddingAcknowledged] = useState({})

  useEffect(() => {
    if (!open) return
    setLoading(true)
    productionPipeline
      .getEmergencyPlan(stationId)
      .then((res) => {
        setPlan(res)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load emergency plan')
        setLoading(false)
      })
  }, [open, stationId])

  if (!open) return null

  const toggleShed = (idx) => {
    setSheddingAcknowledged((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }))
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass rounded-2xl w-[860px] max-w-full h-[650px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-red-500/40 bg-ink-950/90"
        >
          {/* Emergency Header */}
          <div className="p-4 border-b border-red-500/20 flex items-center justify-between bg-red-950/30">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 font-bold text-lg animate-pulse">
                🚨
              </div>
              <div>
                <h3 className="font-display font-semibold text-red-200 text-sm flex items-center gap-2">
                  EMERGENCY MODE & LOAD SHEDDING DISPATCH
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-red-500/30 text-red-300 border border-red-500/40 font-bold">
                    PRIORITY OVERRIDE ACTIVE
                  </span>
                </h3>
                <p className="text-[11px] text-red-300/70">
                  Station: <b className="text-white">{stationId.toUpperCase()}</b> · Protocol: SIH26060 Polar Life Safety
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-red-300/60 hover:text-white text-sm p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading && (
              <div className="text-center py-12 text-xs font-mono text-red-300/60">
                Evaluating emergency load shed thresholds…
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                {error}
              </div>
            )}

            {plan && (
              <>
                {/* Pinned Critical Items (NEVER FILTERABLE) */}
                <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 space-y-2">
                  <div className="text-xs font-bold text-red-300 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                    PINNED CRITICAL LIFE-SAFETY THREATS (CANNOT BE HIDDEN)
                  </div>
                  {plan.pinnedCritical?.length ? (
                    <div className="space-y-1.5">
                      {plan.pinnedCritical.map((crit, cIdx) => (
                        <div
                          key={cIdx}
                          className="flex items-center justify-between p-2 rounded-lg bg-red-900/30 border border-red-500/30 text-xs font-mono text-red-100"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-red-400 font-bold">⚠️ CRITICAL:</span>
                            <span>{crit.message || crit.detail}</span>
                          </div>
                          <span className="text-[10px] text-red-300/70 font-sans uppercase">
                            {crit.category || 'SAFETY'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-400 p-2 font-mono">
                      ✓ No immediate life-safety thresholds are currently breached.
                    </div>
                  )}
                </div>

                {/* Ranked Load Shedding Hierarchy */}
                <div className="glass rounded-xl p-3 border border-white/10 space-y-2">
                  <div className="text-xs font-semibold text-ice-100 flex justify-between items-center">
                    <span>Hierarchical Load Protection Protocol</span>
                    <span className="text-[10px] text-ice-300/60 font-mono">Order 1 to 6</span>
                  </div>

                  <div className="space-y-2">
                    {plan.priorities?.map((tier, tIdx) => (
                      <div
                        key={tIdx}
                        className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                          tier.status === 'critical'
                            ? 'bg-red-950/30 border-red-500/40'
                            : tier.status === 'warning'
                            ? 'bg-amber-950/20 border-amber-500/30'
                            : 'bg-white/5 border-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center font-mono font-bold text-xs text-ice-100">
                            #{tier.rank}
                          </span>
                          <div>
                            <div className="text-xs font-semibold text-ice-100 flex items-center gap-2">
                              {tier.label}
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-mono uppercase ${
                                  tier.status === 'critical'
                                    ? 'bg-red-500/20 text-red-400'
                                    : tier.status === 'warning'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-emerald-500/20 text-emerald-400'
                                }`}
                              >
                                {tier.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-ice-300/70 mt-0.5">{tier.detail}</div>
                          </div>
                        </div>

                        {/* Interactive Load Shed Toggle */}
                        {tier.category !== 'critical_power' && tier.category !== 'medical' && (
                          <button
                            onClick={() => toggleShed(tIdx)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                              sheddingAcknowledged[tIdx]
                                ? 'bg-amber-500 text-ink-950 font-bold border-amber-400'
                                : 'bg-white/5 text-ice-300 border-white/10 hover:bg-white/10'
                            }`}
                          >
                            {sheddingAcknowledged[tIdx] ? '✓ SHED' : 'SHED LOAD'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
