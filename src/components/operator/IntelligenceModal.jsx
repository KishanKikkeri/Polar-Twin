import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'

const ENGINES = [
  { id: 'forecast', label: 'Forecasts', icon: '📈', desc: 'Predictive Demand & Fuel Trajectories' },
  { id: 'anomalies', label: 'Anomalies', icon: '⚡', desc: 'Seasonal Z-Score Outlier Detection' },
  { id: 'maintenance', label: 'Maintenance', icon: '🔧', desc: 'Health Index & 7-Day Failure Probabilities' },
  { id: 'risk', label: 'Risk Analysis', icon: '🛡', desc: 'Composite Multi-Factor Risk Vector' },
  { id: 'recommendations', label: 'Recommendations', icon: '💡', desc: 'Evidence-Backed Mitigation Strategies' },
]

export default function IntelligenceModal({ open, onClose, stationId = 'maitri', initialEngine = 'forecast' }) {
  const [activeEngine, setActiveEngine] = useState(initialEngine)
  const [intelData, setIntelData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [forecastMetric, setForecastMetric] = useState('demandKw')
  const [forecastHorizon, setForecastHorizon] = useState(24)

  const fetchIntelligence = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await productionPipeline.getStationIntelligence(stationId)
      setIntelData(res)
    } catch (err) {
      setError(err.message || 'Failed to fetch station intelligence')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchIntelligence()
    }
  }, [open, stationId])

  useEffect(() => {
    if (initialEngine) {
      setActiveEngine(initialEngine)
    }
  }, [initialEngine])

  if (!open) return null

  const recList = Array.isArray(intelData?.recommendations)
    ? intelData.recommendations
    : intelData?.recommendations?.recommendations || []

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass rounded-2xl w-[1040px] max-w-full h-[740px] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-indigo-500/30 bg-ink-950/95"
        >
          {/* Header */}
          <div className="p-4 border-b border-ice-accent/20 flex items-center justify-between bg-indigo-950/20">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-lg">
                🧠
              </div>
              <div>
                <h3 className="font-display font-semibold text-ice-100 text-sm flex items-center gap-2">
                  STATION INTELLIGENCE ENGINES
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                    4B PREDICTIVE INFERENCE
                  </span>
                </h3>
                <p className="text-[11px] text-ice-300/70">
                  Station: <b className="text-white">{stationId.toUpperCase()}</b> · Causal telemetry feeding 5 predictive intelligence models
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchIntelligence}
                disabled={loading}
                className="glass rounded-lg px-2.5 py-1.5 text-xs text-ice-300 hover:text-ice-100 transition-colors"
                title="Refresh models"
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

          {/* Engine Selection Tabs */}
          <div className="px-4 py-2 border-b border-ice-accent/10 flex items-center gap-2 overflow-x-auto bg-ink-900/50">
            {ENGINES.map((eng) => {
              const active = activeEngine === eng.id
              return (
                <button
                  key={eng.id}
                  onClick={() => setActiveEngine(eng.id)}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs flex items-center gap-2 transition-all ${
                    active
                      ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 font-semibold shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                      : 'text-ice-300/70 hover:text-ice-100 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span>{eng.icon}</span>
                  <span>{eng.label}</span>
                </button>
              )
            })}
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center text-ice-300 gap-3">
                <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-mono">Running predictive models for {stationId.toUpperCase()}...</p>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-xs">
                {error}
              </div>
            ) : (
              <>
                {/* 1. FORECASTS TAB */}
                {activeEngine === 'forecast' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-ink-900/60 p-3 rounded-xl border border-ice-accent/10">
                      <div>
                        <h4 className="font-semibold text-ice-100 text-xs flex items-center gap-2">
                          <span>📈 DEMAND & RESOURCE FORECASTING</span>
                          <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                            {intelData?.forecast?.model?.name || 'RIDGE-REGRESSION'} v{intelData?.forecast?.model?.version || '1.0'}
                          </span>
                        </h4>
                        <p className="text-[11px] text-ice-300/70">
                          Metric: {intelData?.forecast?.metric || 'demandKw'} · Horizon: {intelData?.forecast?.horizonH || 24} Hours
                        </p>
                      </div>

                      {intelData?.forecast?.confidence && (
                        <div className="text-right font-mono text-xs">
                          <div className="text-[10px] text-ice-400">MODEL CONFIDENCE</div>
                          <div className="text-emerald-400 font-bold">
                            {Math.round((intelData.forecast.confidence.score || 0.85) * 100)}%
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Forecast Points Graph / Table */}
                    {intelData?.forecast?.points?.length ? (
                      <div className="space-y-3">
                        <div className="p-4 rounded-xl bg-ink-900/40 border border-ice-accent/10">
                          <div className="text-xs font-mono text-ice-300 mb-3 flex items-center justify-between">
                            <span>TRAJECTORY CURVE (HOURLY)</span>
                            <span className="text-[10px] text-ice-400">Unit: {intelData.forecast.unit || 'kW'}</span>
                          </div>

                          {/* Mini visual bar projection */}
                          <div className="h-32 flex items-end gap-1.5 pt-4 pb-1 border-b border-ice-accent/15 overflow-x-auto">
                            {intelData.forecast.points.map((pt, i) => {
                              const maxVal = Math.max(...intelData.forecast.points.map((p) => p.value), 1)
                              const heightPct = Math.max(10, Math.round((pt.value / maxVal) * 100))
                              return (
                                <div
                                  key={i}
                                  className="flex-1 min-w-[22px] flex flex-col items-center gap-1 group relative"
                                >
                                  <div
                                    style={{ height: `${heightPct}%` }}
                                    className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-cyan-400 group-hover:from-indigo-500 group-hover:to-cyan-300 transition-all cursor-pointer"
                                  />
                                  <span className="text-[9px] font-mono text-ice-400/80">+{pt.offsetH}h</span>

                                  {/* Tooltip on hover */}
                                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                                    <div className="bg-ink-950 px-2 py-1 rounded text-[10px] font-mono text-ice-100 border border-ice-accent/30 shadow-lg whitespace-nowrap">
                                      {pt.value} {intelData.forecast.unit || 'kW'}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Forecast Stats Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 rounded-xl bg-ink-900/40 border border-ice-accent/10">
                            <div className="text-[10px] font-mono text-ice-400">PEAK FORECAST</div>
                            <div className="text-base font-bold text-cyan-300 font-mono mt-1">
                              {Math.max(...intelData.forecast.points.map((p) => p.value))} {intelData.forecast.unit || 'kW'}
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-ink-900/40 border border-ice-accent/10">
                            <div className="text-[10px] font-mono text-ice-400">AVERAGE FORECAST</div>
                            <div className="text-base font-bold text-ice-100 font-mono mt-1">
                              {Math.round(
                                intelData.forecast.points.reduce((acc, p) => acc + p.value, 0) /
                                  intelData.forecast.points.length
                              )}{' '}
                              {intelData.forecast.unit || 'kW'}
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-ink-900/40 border border-ice-accent/10">
                            <div className="text-[10px] font-mono text-ice-400">MINIMUM FORECAST</div>
                            <div className="text-base font-bold text-indigo-300 font-mono mt-1">
                              {Math.min(...intelData.forecast.points.map((p) => p.value))} {intelData.forecast.unit || 'kW'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-ice-400 font-mono text-xs">
                        No active forecast trajectory available for selected horizon.
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ANOMALIES TAB */}
                {activeEngine === 'anomalies' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-ink-900/60 p-3 rounded-xl border border-ice-accent/10">
                      <div>
                        <h4 className="font-semibold text-ice-100 text-xs flex items-center gap-2">
                          <span>⚡ ANOMALY DETECTION ENGINE</span>
                          <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                            ROBUST-SEASONAL-ZSCORE
                          </span>
                        </h4>
                        <p className="text-[11px] text-ice-300/70">
                          Detects deviation from baseline seasonal pattern with z-score variance calculation
                        </p>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="text-[10px] text-ice-400">ACTIVE OUTLIERS</div>
                        <div className="text-amber-400 font-bold">{intelData?.anomalies?.length || 0} Detected</div>
                      </div>
                    </div>

                    {intelData?.anomalies?.length ? (
                      <div className="space-y-2">
                        {intelData.anomalies.map((anom, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                              anom.severity === 'critical'
                                ? 'bg-red-950/20 border-red-500/30 text-red-200'
                                : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 font-mono font-bold">
                                <span className={anom.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                                  {anom.severity === 'critical' ? '🚨 CRITICAL' : '⚠ WARNING'}
                                </span>
                                <span>{anom.metric || anom.channel}</span>
                                {anom.assetId && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-white/10 font-normal">
                                    Asset: {anom.assetId}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] opacity-80">{anom.message || 'Significant deviation from baseline'}</p>
                            </div>

                            <div className="text-right font-mono text-xs">
                              <div>
                                Value: <b className="text-white">{anom.value}</b> (Expected: {anom.expected})
                              </div>
                              <div className="text-[10px] text-ice-400">
                                Z-Score: {anom.zScore ? Math.round(anom.zScore * 100) / 100 : 'N/A'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-emerald-400 font-mono text-xs bg-emerald-950/10 border border-emerald-500/20 rounded-xl">
                        ✓ All station telemetry channels operating within nominal standard deviation envelope.
                      </div>
                    )}
                  </div>
                )}

                {/* 3. MAINTENANCE TAB */}
                {activeEngine === 'maintenance' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-ink-900/60 p-3 rounded-xl border border-ice-accent/10">
                      <div>
                        <h4 className="font-semibold text-ice-100 text-xs flex items-center gap-2">
                          <span>🔧 ASSET HEALTH & DEGRADATION FORECAST</span>
                          <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">
                            WEIBULL DEGRADATION MODEL
                          </span>
                        </h4>
                        <p className="text-[11px] text-ice-300/70">
                          Predicts mechanical wear, failure probability over 7-day horizon, and maintenance schedules
                        </p>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="text-[10px] text-ice-400">TRACKED UNITS</div>
                        <div className="text-cyan-400 font-bold">{intelData?.maintenance?.length || 0} Assets</div>
                      </div>
                    </div>

                    {intelData?.maintenance?.length ? (
                      <div className="grid grid-cols-2 gap-3">
                        {intelData.maintenance.map((m, idx) => {
                          const health = m.healthScore != null ? Math.round(m.healthScore * 100) : 90
                          const failProb = m.failureProbabilityNext7d != null ? Math.round(m.failureProbabilityNext7d * 100) : 5
                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-ink-900/50 border border-ice-accent/10 space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-mono font-bold text-xs text-ice-100 flex items-center gap-2">
                                  <span>⚙ {m.assetId.toUpperCase()}</span>
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 uppercase text-ice-300">
                                    {m.assetType}
                                  </span>
                                </div>
                                <span
                                  className={`text-xs font-mono font-bold ${
                                    health > 80 ? 'text-emerald-400' : health > 50 ? 'text-amber-400' : 'text-red-400'
                                  }`}
                                >
                                  {health}% HEALTH
                                </span>
                              </div>

                              {/* Health Bar */}
                              <div className="h-2 rounded-full bg-ink-950 overflow-hidden">
                                <div
                                  style={{ width: `${health}%` }}
                                  className={`h-full rounded-full ${
                                    health > 80 ? 'bg-emerald-400' : health > 50 ? 'bg-amber-400' : 'bg-red-400'
                                  }`}
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 text-ice-300">
                                <div>
                                  <span className="text-ice-400 text-[10px] block">7-DAY RISK:</span>
                                  <span className={failProb > 25 ? 'text-red-400 font-bold' : 'text-ice-200'}>
                                    {failProb}% Prob.
                                  </span>
                                </div>
                                <div>
                                  <span className="text-ice-400 text-[10px] block">DEGRADATION:</span>
                                  <span>{m.degradationSlope ? `${m.degradationSlope}/day` : 'Nominal'}</span>
                                </div>
                              </div>

                              {m.action && (
                                <div className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-[11px] text-indigo-200">
                                  💡 <b>Recommendation:</b> {m.action}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-ice-400 font-mono text-xs">
                        No asset degradation telemetry currently logged.
                      </div>
                    )}
                  </div>
                )}

                {/* 4. RISK ANALYSIS TAB */}
                {activeEngine === 'risk' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-ink-900/60 p-3 rounded-xl border border-ice-accent/10">
                      <div>
                        <h4 className="font-semibold text-ice-100 text-xs flex items-center gap-2">
                          <span>🛡 MULTI-FACTOR COMPOSITE RISK</span>
                          <span className="text-[10px] font-mono text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded border border-purple-500/30">
                            COMPOSITE-VECTOR-RISK
                          </span>
                        </h4>
                        <p className="text-[11px] text-ice-300/70">
                          Synthesizes power, thermal, logistics, comms, and asset health into unified station safety index
                        </p>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="text-[10px] text-ice-400">OVERALL RISK SCORE</div>
                        <div
                          className={`text-base font-bold ${
                            (intelData?.risk?.score || 0) > 60
                              ? 'text-red-400'
                              : (intelData?.risk?.score || 0) > 30
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {intelData?.risk?.score ?? '24'} / 100 ({intelData?.risk?.level?.toUpperCase() || 'LOW'})
                        </div>
                      </div>
                    </div>

                    {/* Breakdown by vector */}
                    {intelData?.risk?.breakdown && (
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries(intelData.risk.breakdown).map(([dim, score]) => (
                          <div
                            key={dim}
                            className="p-3 rounded-xl bg-ink-900/40 border border-ice-accent/10 space-y-2"
                          >
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className="capitalize font-bold text-ice-200">{dim} Dimension</span>
                              <span
                                className={`font-bold ${
                                  score > 50 ? 'text-red-400' : score > 25 ? 'text-amber-400' : 'text-emerald-400'
                                }`}
                              >
                                {score} / 100
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-ink-950 overflow-hidden">
                              <div
                                style={{ width: `${Math.min(100, score)}%` }}
                                className={`h-full rounded-full ${
                                  score > 50 ? 'bg-red-400' : score > 25 ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Risk Drivers */}
                    {intelData?.risk?.drivers?.length ? (
                      <div className="p-3.5 rounded-xl bg-ink-900/40 border border-ice-accent/10 space-y-2">
                        <div className="text-xs font-mono font-bold text-ice-200">PRIMARY RISK DRIVERS</div>
                        <ul className="space-y-1.5 text-xs text-ice-300">
                          {intelData.risk.drivers.map((drv, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="text-amber-400">•</span>
                              <span>{drv}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 5. RECOMMENDATIONS TAB */}
                {activeEngine === 'recommendations' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-ink-900/60 p-3 rounded-xl border border-ice-accent/10">
                      <div>
                        <h4 className="font-semibold text-ice-100 text-xs flex items-center gap-2">
                          <span>💡 GROUNDED OPERATOR RECOMMENDATIONS</span>
                          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                            RULE-OPTIMIZER-RECS
                          </span>
                        </h4>
                        <p className="text-[11px] text-ice-300/70">
                          Actionable, prioritized recommendations with verified operational rationale and evidence
                        </p>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="text-[10px] text-ice-400">TOTAL ADVISORIES</div>
                        <div className="text-emerald-400 font-bold">{recList.length} Active</div>
                      </div>
                    </div>

                    {recList.length ? (
                      <div className="space-y-2.5">
                        {recList.map((rec, idx) => (
                          <div
                            key={rec.id || idx}
                            className="p-3.5 rounded-xl bg-ink-900/50 border border-ice-accent/10 space-y-2 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-semibold text-ice-100 flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center text-[10px] font-bold">
                                  {rec.priority || idx + 1}
                                </span>
                                <span>{rec.action}</span>
                              </div>
                              {rec.impact && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-cyan-300">
                                  Impact: {rec.impact}
                                </span>
                              )}
                            </div>

                            <p className="text-ice-300/80 leading-relaxed text-[11px] pl-7">
                              {rec.rationale || rec.reason}
                            </p>

                            {rec.evidence && (
                              <div className="pl-7 text-[10px] font-mono text-ice-400 flex items-center gap-2">
                                <span className="text-indigo-400">📊 Evidence:</span>
                                <span>{typeof rec.evidence === 'string' ? rec.evidence : JSON.stringify(rec.evidence)}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-ice-400 font-mono text-xs bg-ink-900/20 rounded-xl border border-ice-accent/10">
                        No active operational interventions required. Baseline stability maintained.
                      </div>
                    )}
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
