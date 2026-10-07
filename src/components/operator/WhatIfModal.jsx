import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'

const PRESET_SCENARIOS = [
  {
    id: 'dg1_failure',
    label: 'DG-1 Failure (8 Hours)',
    scenario: {
      type: 'generator_failure',
      generatorId: 'DG-1',
      durationH: 8,
    },
  },
  {
    id: 'cold_snap',
    label: 'Blizzard & Severe Cold Snap (-28°C, 25 m/s)',
    scenario: {
      type: 'cold_snap',
      outdoorC: -28,
      windMs: 25,
      durationH: 12,
    },
  },
  {
    id: 'resupply_delay',
    label: 'Vessel Resupply Delayed by 72h',
    scenario: {
      type: 'resupply_delay',
      delayH: 72,
    },
  },
  {
    id: 'load_spike',
    label: 'Heavy Research & HVAC Load Spike (+35%)',
    scenario: {
      type: 'load_spike',
      multiplier: 1.35,
      durationH: 6,
    },
  },
]

export default function WhatIfModal({ open, onClose, stationId = 'maitri' }) {
  const [selectedPreset, setSelectedPreset] = useState(PRESET_SCENARIOS[0].id)
  const [customDuration, setCustomDuration] = useState(8)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runSimulation = async (scenarioObj) => {
    setRunning(true)
    setError(null)
    try {
      const activePreset = PRESET_SCENARIOS.find((p) => p.id === selectedPreset)
      const targetScenario = scenarioObj || activePreset?.scenario || PRESET_SCENARIOS[0].scenario
      const res = await productionPipeline.runWhatIf(stationId, targetScenario)
      setResult(res)
    } catch (err) {
      setError(err.message || 'Simulation error')
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (open) {
      runSimulation()
    }
  }, [open, selectedPreset, stationId])

  if (!open) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass glow-border rounded-2xl w-[840px] max-w-full h-[650px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-ice-accent/30"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-ink-950/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-status-warn/20 border border-status-warn/40 flex items-center justify-center text-status-warn font-bold text-sm">
                ⚡
              </div>
              <div>
                <h3 className="font-display font-semibold text-ice-100 text-sm flex items-center gap-2">
                  What-If Scenario Simulation Engine
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-status-warn/20 text-status-warn border border-status-warn/30">
                    Causal Forward Simulation · 4C
                  </span>
                </h3>
                <p className="text-[11px] text-ice-300/60">
                  Target: <b className="text-ice-100">{stationId.toUpperCase()}</b> · Deterministic contingency propagation
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-ice-300/60 hover:text-ice-100 text-sm p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Scenario Selector */}
          <div className="p-4 bg-ink-950/30 border-b border-white/5 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-ice-300/70 font-semibold mr-1">Scenario:</span>
            {PRESET_SCENARIOS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                  selectedPreset === p.id
                    ? 'bg-ice-accent/20 border-ice-accent text-ice-accent font-semibold'
                    : 'bg-white/5 border-white/10 text-ice-200 hover:bg-white/10'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {running && (
              <div className="flex items-center justify-center h-48 text-xs text-ice-300/60 font-mono">
                <span className="inline-block w-3 h-3 rounded-full bg-ice-accent animate-ping mr-2" />
                Simulating physical failure cascades and calculating risk delta…
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs">
                <b>Simulation failed:</b> {error}
              </div>
            )}

            {result && !running && (
              <>
                {/* Risk Delta Banner */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase">Baseline Risk</div>
                    <div className="text-xl font-mono font-bold text-ice-100 mt-1">
                      {result.comparison?.riskImpact?.baseline?.score}{' '}
                      <span className="text-xs font-normal text-ice-300/70 uppercase">
                        ({result.comparison?.riskImpact?.baseline?.level})
                      </span>
                    </div>
                  </div>

                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase">Scenario Risk</div>
                    <div className="text-xl font-mono font-bold text-status-warn mt-1">
                      {result.comparison?.riskImpact?.scenario?.score}{' '}
                      <span className="text-xs font-normal text-status-warn/80 uppercase">
                        ({result.comparison?.riskImpact?.scenario?.level})
                      </span>
                    </div>
                  </div>

                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase">Risk Delta</div>
                    <div className="text-xl font-mono font-bold text-ice-accent mt-1">
                      +{result.comparison?.riskImpact?.delta || 0} pts
                    </div>
                  </div>
                </div>

                {/* Metrics Comparison Table */}
                <div className="glass rounded-xl border border-white/10 overflow-hidden">
                  <div className="p-2.5 bg-white/5 border-b border-white/10 text-xs font-semibold text-ice-100 flex justify-between items-center">
                    <span>Impacted Physical Indicators</span>
                    <span className="text-[10px] text-ice-300/60 font-mono">Run ID: {result.id}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-ink-950/40 text-ice-300/60 text-[10px] uppercase font-mono">
                        <tr>
                          <th className="p-2.5">Metric</th>
                          <th className="p-2.5">Baseline</th>
                          <th className="p-2.5">Scenario</th>
                          <th className="p-2.5">Difference</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono">
                        {result.comparison?.rows?.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-white/5 transition-colors">
                            <td className="p-2.5 text-ice-200 font-sans">{row.label}</td>
                            <td className="p-2.5 text-ice-300/80">{row.baseline} {row.unit}</td>
                            <td className="p-2.5 text-ice-100 font-semibold">{row.scenario} {row.unit}</td>
                            <td className="p-2.5">
                              <span className={row.absDiff > 0 ? 'text-status-warn' : row.absDiff < 0 ? 'text-status-good' : 'text-ice-300/40'}>
                                {row.absDiff > 0 ? `+${row.absDiff}` : row.absDiff} {row.unit}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  row.direction === 'worse'
                                    ? 'bg-status-warn/20 text-status-warn'
                                    : row.direction === 'better'
                                    ? 'bg-status-good/20 text-status-good'
                                    : 'text-ice-300/40'
                                }`}
                              >
                                {row.direction.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Priority Operational Recommendations */}
                {result.comparison?.recommendations?.length > 0 && (
                  <div className="glass rounded-xl p-3 border border-white/10 space-y-2">
                    <div className="text-xs font-semibold text-ice-100 flex items-center gap-2">
                      <span>⚡ Priority Mitigation Actions:</span>
                    </div>
                    <div className="space-y-1.5">
                      {result.comparison.recommendations.map((rec, rcIdx) => (
                        <div
                          key={rcIdx}
                          className="flex items-start gap-2 text-xs p-2 rounded-lg bg-white/5 border border-white/5"
                        >
                          <span className="w-5 h-5 rounded-full bg-ice-accent/20 text-ice-accent flex items-center justify-center font-bold text-[10px] shrink-0">
                            #{rec.priority}
                          </span>
                          <div className="flex-1">
                            <div className="font-semibold text-ice-100">{rec.action}</div>
                            <div className="text-[11px] text-ice-300/70">{rec.reason}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
