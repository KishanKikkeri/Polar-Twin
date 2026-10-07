import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'
import { initialReplayState, replayReducer } from '../../decision/replay.js'

export default function ReplayModal({ open, onClose, stationId = 'maitri' }) {
  const [session, setSession] = useState(null)
  const [ctrlState, setCtrlState] = useState(null)
  const [frame, setFrame] = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  // Initialize 24h replay window
  useEffect(() => {
    if (!open) return
    const nowMs = Date.now()
    const fromMs = nowMs - 24 * 3600 * 1000
    const toMs = nowMs

    const replay = productionPipeline.createReplaySession(stationId, {
      from: fromMs,
      to: toMs,
      stepMs: 3600 * 1000,
    })
    setSession(replay)
    setCtrlState(initialReplayState({ from: fromMs, to: toMs, stepMs: 3600 * 1000 }))
  }, [open, stationId])

  // Fetch frame when cursor moves
  useEffect(() => {
    if (!session || !ctrlState) return
    let cancelled = false
    setLoading(true)

    session.frameAt(ctrlState.cursorMs).then((f) => {
      if (!cancelled) {
        setFrame(f)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [session, ctrlState?.cursorMs])

  // Playback timer
  useEffect(() => {
    if (!ctrlState?.playing) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => {
      setCtrlState((prev) => replayReducer(prev, { type: 'tick' }))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [ctrlState?.playing])

  if (!open) return null

  const progressPct = ctrlState
    ? Math.min(100, Math.max(0, ((ctrlState.cursorMs - ctrlState.fromMs) / (ctrlState.toMs - ctrlState.fromMs)) * 100))
    : 0

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass glow-border rounded-2xl w-[820px] max-w-full h-[620px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-ice-accent/30"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-ink-950/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 font-bold text-sm">
                ⏪
              </div>
              <div>
                <h3 className="font-display font-semibold text-ice-100 text-sm flex items-center gap-2">
                  Historical Incident & State Replay
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                    Temporal Reconstruction · 4C
                  </span>
                </h3>
                <p className="text-[11px] text-ice-300/60">
                  Station: <b className="text-ice-100">{stationId.toUpperCase()}</b> · Exact as_of temporal reconstruction
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

          {/* Timeline & Controls Toolbar */}
          <div className="p-4 bg-ink-950/30 border-b border-white/5 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-ice-200">
              <span>{ctrlState ? new Date(ctrlState.fromMs).toLocaleString() : ''}</span>
              <span className="text-ice-accent font-bold px-2 py-0.5 rounded bg-ice-accent/10 border border-ice-accent/30">
                CURSOR: {ctrlState ? new Date(ctrlState.cursorMs).toLocaleString() : ''}
              </span>
              <span>{ctrlState ? new Date(ctrlState.toMs).toLocaleString() : ''}</span>
            </div>

            {/* Scrubber Slider */}
            <input
              type="range"
              min={ctrlState?.fromMs || 0}
              max={ctrlState?.toMs || 100}
              step={3600 * 1000}
              value={ctrlState?.cursorMs || 0}
              onChange={(e) =>
                setCtrlState((prev) => replayReducer(prev, { type: 'seek', to: Number(e.target.value) }))
              }
              className="w-full accent-ice-accent cursor-pointer h-1.5 bg-white/10 rounded-lg"
            />

            {/* Playback Button Group */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCtrlState((prev) => replayReducer(prev, { type: 'step', dir: -1 }))}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs border border-white/10 text-ice-200"
                >
                  ⏮ -1h
                </button>
                <button
                  onClick={() =>
                    setCtrlState((prev) =>
                      replayReducer(prev, { type: prev.playing ? 'pause' : 'play' })
                    )
                  }
                  className={`px-4 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    ctrlState?.playing
                      ? 'bg-status-warn text-ink-950 border-status-warn'
                      : 'bg-ice-accent text-ink-950 border-ice-accent'
                  }`}
                >
                  {ctrlState?.playing ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                  onClick={() => setCtrlState((prev) => replayReducer(prev, { type: 'step', dir: 1 }))}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs border border-white/10 text-ice-200"
                >
                  +1h ⏭
                </button>
              </div>

              {/* Speed buttons */}
              <div className="flex items-center gap-1 text-[11px] font-mono">
                <span className="text-ice-300/60 mr-1">Speed:</span>
                {[1, 2, 5, 10].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setCtrlState((prev) => replayReducer(prev, { type: 'speed', value: spd }))}
                    className={`px-2 py-0.5 rounded border ${
                      ctrlState?.speed === spd
                        ? 'bg-white/20 border-white/40 text-ice-100 font-bold'
                        : 'bg-white/5 border-white/5 text-ice-300/70 hover:bg-white/10'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reconstructed State Inspection */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading && (
              <div className="text-center py-4 text-xs font-mono text-ice-300/60">
                <span className="inline-block w-2 h-2 rounded-full bg-ice-accent animate-ping mr-2" />
                Reconstructing digital twin state at timestamp…
              </div>
            )}

            {frame?.state && (
              <>
                <div className="grid grid-cols-4 gap-3 font-mono">
                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase font-sans">Power Demand</div>
                    <div className="text-lg font-bold text-ice-100 mt-1">
                      {frame.state.energy?.baseDemandKw || '—'} kW
                    </div>
                  </div>
                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase font-sans">Indoor Temperature</div>
                    <div className="text-lg font-bold text-ice-100 mt-1">
                      {frame.state.thermal?.indoorC || '—'} °C
                    </div>
                  </div>
                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase font-sans">Fuel Autonomy</div>
                    <div className="text-lg font-bold text-ice-100 mt-1">
                      {frame.state.logistics?.daysOfAutonomy || Math.round((frame.state.fuel?.tankL || 0) / (frame.state.fuel?.burnLph || 25) / 24)} d
                    </div>
                  </div>
                  <div className="glass p-3 rounded-xl border border-white/10">
                    <div className="text-[10px] text-ice-300/60 uppercase font-sans">Comms Link</div>
                    <div className="text-lg font-bold text-emerald-400 mt-1">
                      {Math.round((frame.state.comms?.linkQuality || 0.95) * 100)}%
                    </div>
                  </div>
                </div>

                {/* Generator Asset States */}
                <div className="glass rounded-xl p-3 border border-white/10">
                  <div className="text-xs font-semibold text-ice-100 mb-2 font-sans">
                    Generator Dispatch At Cursor
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                    {(frame.state.assets || []).map((gen, gIdx) => (
                      <div
                        key={gIdx}
                        className="p-2.5 rounded-lg bg-white/5 border border-white/5 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-ice-100">{gen.id}</div>
                          <div className="text-[10px] text-ice-300/60">{gen.loading != null ? `${Math.round(gen.loading)} kW` : '—'}</div>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-sans uppercase font-bold ${
                            gen.status === 'online'
                              ? 'bg-status-good/20 text-status-good'
                              : 'bg-status-warn/20 text-status-warn'
                          }`}
                        >
                          {gen.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Event Log Up to Cursor */}
                <div className="glass rounded-xl p-3 border border-white/10">
                  <div className="text-xs font-semibold text-ice-100 mb-2 font-sans flex justify-between items-center">
                    <span>Events Preceding Cursor</span>
                    <span className="text-[10px] font-mono text-ice-300/60">
                      {frame.events?.length || 0} events recorded
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {frame.events?.length ? (
                      frame.events.map((evt, eIdx) => (
                        <div
                          key={eIdx}
                          className="flex items-center justify-between p-2 rounded-lg bg-white/5 text-xs font-mono"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                evt.severity === 'critical'
                                  ? 'bg-red-400'
                                  : evt.severity === 'warning'
                                  ? 'bg-amber-400'
                                  : 'bg-blue-400'
                              }`}
                            />
                            <span className="text-ice-200">{evt.message}</span>
                          </div>
                          <span className="text-[10px] text-ice-300/50">
                            {new Date(evt.ts).toLocaleTimeString()}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ice-300/50 italic p-2">
                        No operational alarms or disruptions occurred in this time window.
                      </div>
                    )}
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
