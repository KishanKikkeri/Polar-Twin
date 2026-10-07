import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'

const DIMENSION_ICONS = {
  energy: '⚡',
  fuel: '🛢',
  condition: '🩺',
  infrastructure: '🏗',
  risk: '🛡',
  logistics: '📦',
  environment: '❄',
}

const DIMENSION_LABELS = {
  energy: 'Energy & Power',
  fuel: 'Fuel Reserves',
  condition: 'Asset Health',
  infrastructure: 'Station Infrastructure',
  risk: 'Operational Risk',
  logistics: 'Supply Chain',
  environment: 'Meteorological Conditions',
}

export default function CompareModal({ open, onClose, defaultStationA = 'maitri', defaultStationB = 'bharati' }) {
  const [stationA, setStationA] = useState(defaultStationA)
  const [stationB, setStationB] = useState(defaultStationB)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeDimension, setActiveDimension] = useState('all')

  const fetchComparison = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await productionPipeline.getComparison(stationA, stationB)
      if (!res.ok) {
        throw new Error(res.code || 'Failed to compare stations')
      }
      setComparison(res)
    } catch (err) {
      setError(err.message || 'Error fetching comparison data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchComparison()
    }
  }, [open, stationA, stationB])

  if (!open) return null

  const handleSwap = () => {
    setStationA(stationB)
    setStationB(stationA)
  }

  // Group rows by dimension
  const rows = comparison?.rows || []
  const dimensions = Array.from(new Set(rows.map((r) => r.dimension)))
  const filteredRows = activeDimension === 'all' ? rows : rows.filter((r) => r.dimension === activeDimension)

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass rounded-2xl w-[980px] max-w-full h-[720px] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-cyan-500/30 bg-ink-950/95"
        >
          {/* Header */}
          <div className="p-4 border-b border-ice-accent/20 flex items-center justify-between bg-cyan-950/20">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold text-lg">
                ⚖
              </div>
              <div>
                <h3 className="font-display font-semibold text-ice-100 text-sm flex items-center gap-2">
                  STATION DUAL-TWIN COMPARISON
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
                    GROUNDED 4A RUNTIME
                  </span>
                </h3>
                <p className="text-[11px] text-ice-300/70">
                  Side-by-side telemetry, power margin, fuel autonomy, asset health, and risk differentials
                </p>
              </div>
            </div>

            {/* Station selector controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-ink-900/80 px-2.5 py-1 rounded-lg border border-ice-accent/20">
                <select
                  value={stationA}
                  onChange={(e) => setStationA(e.target.value)}
                  className="bg-transparent text-xs text-cyan-300 font-mono font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="maitri" className="bg-ink-950 text-ice-100">MAITRI</option>
                  <option value="bharati" className="bg-ink-950 text-ice-100">BHARATI</option>
                </select>
                <button
                  onClick={handleSwap}
                  title="Swap stations"
                  className="px-1.5 py-0.5 rounded text-xs text-ice-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  ⇄
                </button>
                <select
                  value={stationB}
                  onChange={(e) => setStationB(e.target.value)}
                  className="bg-transparent text-xs text-amber-300 font-mono font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="maitri" className="bg-ink-950 text-ice-100">MAITRI</option>
                  <option value="bharati" className="bg-ink-950 text-ice-100">BHARATI</option>
                </select>
              </div>

              <button
                onClick={fetchComparison}
                disabled={loading}
                className="glass rounded-lg px-2.5 py-1.5 text-xs text-ice-300 hover:text-ice-100 transition-colors"
                title="Refresh comparison"
              >
                🔄
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg glass text-ice-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Dimension Filter Tabs */}
          <div className="px-4 py-2 border-b border-ice-accent/10 flex items-center gap-1.5 overflow-x-auto bg-ink-900/40 text-xs">
            <button
              onClick={() => setActiveDimension('all')}
              className={`px-3 py-1 rounded-lg font-mono text-[11px] transition-colors ${
                activeDimension === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'text-ice-300/70 hover:text-ice-100 hover:bg-white/5'
              }`}
            >
              ALL DIMENSIONS ({rows.length})
            </button>
            {dimensions.map((dim) => (
              <button
                key={dim}
                onClick={() => setActiveDimension(dim)}
                className={`px-3 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1.5 transition-colors ${
                  activeDimension === dim
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-ice-300/70 hover:text-ice-100 hover:bg-white/5'
                }`}
              >
                <span>{DIMENSION_ICONS[dim] || '•'}</span>
                <span>{DIMENSION_LABELS[dim] || dim}</span>
              </button>
            ))}
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center text-ice-300 gap-3">
                <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-mono">Synchronizing twin states for {stationA.toUpperCase()} & {stationB.toUpperCase()}...</p>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-xs">
                {error}
              </div>
            ) : (
              <>
                {/* Visual Header Columns */}
                <div className="grid grid-cols-12 gap-3 px-3 py-2 bg-ink-900/80 rounded-xl border border-ice-accent/10 text-xs font-mono font-semibold text-ice-300">
                  <div className="col-span-5 flex items-center gap-2">METRIC & SYSTEM</div>
                  <div className="col-span-3 text-right text-cyan-300 flex items-center justify-end gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>{stationA.toUpperCase()}</span>
                  </div>
                  <div className="col-span-3 text-right text-amber-300 flex items-center justify-end gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>{stationB.toUpperCase()}</span>
                  </div>
                  <div className="col-span-1 text-center text-ice-400">DIFF</div>
                </div>

                {/* Rows List */}
                <div className="space-y-2">
                  {filteredRows.map((row) => {
                    const isBetterA = row.better === 'a'
                    const isBetterB = row.better === 'b'
                    const isTie = row.better === 'tie'

                    return (
                      <div
                        key={row.metric}
                        className="grid grid-cols-12 gap-3 items-center px-3 py-2.5 rounded-xl bg-ink-900/40 hover:bg-ink-900/70 border border-ice-accent/10 transition-colors text-xs"
                      >
                        {/* Metric name & dimension */}
                        <div className="col-span-5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{DIMENSION_ICONS[row.dimension] || '•'}</span>
                            <span className="font-semibold text-ice-100">{row.label}</span>
                          </div>
                          <span className="text-[10px] text-ice-400/70 font-mono ml-5">
                            {DIMENSION_LABELS[row.dimension]} {row.unit ? `(${row.unit})` : ''}
                          </span>
                        </div>

                        {/* Station A Value */}
                        <div className="col-span-3 text-right font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              isBetterA
                                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30'
                                : 'text-ice-200'
                            }`}
                          >
                            {row.a !== null ? `${row.a} ${row.unit || ''}` : 'N/A'}
                          </span>
                          {isBetterA && (
                            <span className="ml-1 text-[10px] text-cyan-400 font-bold" title="Operational advantage">
                              ★
                            </span>
                          )}
                        </div>

                        {/* Station B Value */}
                        <div className="col-span-3 text-right font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              isBetterB
                                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                                : 'text-ice-200'
                            }`}
                          >
                            {row.b !== null ? `${row.b} ${row.unit || ''}` : 'N/A'}
                          </span>
                          {isBetterB && (
                            <span className="ml-1 text-[10px] text-amber-400 font-bold" title="Operational advantage">
                              ★
                            </span>
                          )}
                        </div>

                        {/* Diff & Advantage Indicator */}
                        <div className="col-span-1 text-center font-mono text-[11px]">
                          {row.diff !== null ? (
                            <span
                              className={`${
                                isBetterB ? 'text-amber-300' : isBetterA ? 'text-cyan-300' : 'text-ice-400'
                              }`}
                            >
                              {row.diff > 0 ? `+${row.diff}` : row.diff}
                            </span>
                          ) : (
                            <span className="text-ice-500">—</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Synthesis & Strategic Insight */}
                <div className="mt-4 p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/20 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 text-xs font-bold font-mono">
                    <span>💡 OPERATOR CROSS-STATION SYNTHESIS</span>
                  </div>
                  <p className="text-xs text-ice-200/90 leading-relaxed">
                    Comparison between <b>{stationA.toUpperCase()}</b> and <b>{stationB.toUpperCase()}</b> tracks
                    dynamic causal margins. If one facility experiences generation strain or fuel shortage,
                    operational policy permits prioritizing supply drops or emergency comms relays accordingly.
                  </p>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
