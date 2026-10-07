import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { productionPipeline } from '../../services/twin/productionPipeline.js'

const SUGGESTED_PROMPTS = [
  'What is the current operational state and fuel autonomy?',
  'What happens if DG-1 fails for 8 hours?',
  'What if the outdoor temperature drops to -28°C with 22 m/s winds?',
  'Are there any active alerts or degraded assets?',
  'What are the top recommended maintenance actions?',
]

export default function CopilotModal({ open, onClose, stationId = 'maitri' }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `Hello! I am the POLARTWIN Operations Copilot. I provide verified answers grounded in the 4A Digital Twin runtime, causal dependency graph, and 4B intelligence models. How can I assist with station ${stationId.toUpperCase()} today?`,
      facts: [],
      sources: ['runtime'],
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showFacts, setShowFacts] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = async (questionText) => {
    const q = (questionText || input).trim()
    if (!q || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: q }])
    setLoading(true)

    try {
      const res = await productionPipeline.askCopilot(q, { stationId })
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.answer || 'No response generated.',
          facts: res.facts || [],
          sources: res.sources || [],
          run: res.run || null,
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Error contacting Operations Copilot: ${err.message || 'Service unavailable'}. No ungrounded figures were substituted.`,
          facts: [],
          sources: ['error'],
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass glow-border rounded-2xl w-[720px] max-w-full h-[620px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-ice-accent/30"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between bg-ink-950/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-ice-accent/20 border border-ice-accent/40 flex items-center justify-center text-ice-accent font-bold text-sm">
                🤖
              </div>
              <div>
                <h3 className="font-display font-semibold text-ice-100 text-sm flex items-center gap-2">
                  Operations Copilot
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Grounded Mode · 4C Decision
                  </span>
                </h3>
                <p className="text-[11px] text-ice-300/60">
                  Target Station: <b className="text-ice-100">{stationId.toUpperCase()}</b> · Strictly verified facts only
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

          {/* Conversation history */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl p-3 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-ice-accent text-ink-950 font-medium'
                      : 'glass border border-white/10 text-ice-100'
                  }`}
                >
                  {m.text}
                </div>

                {m.facts && m.facts.length > 0 && (
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={() => setShowFacts(showFacts === idx ? null : idx)}
                      className="text-[10px] text-ice-accent hover:underline font-mono"
                    >
                      {showFacts === idx ? 'Hide grounding facts ▲' : `View ${m.facts.length} grounding facts ▼`}
                    </button>
                    {m.sources && (
                      <span className="text-[9px] text-ice-300/50">
                        via {m.sources.join(', ')}
                      </span>
                    )}
                  </div>
                )}

                {showFacts === idx && m.facts && (
                  <div className="mt-2 p-2.5 rounded-lg bg-ink-950/80 border border-ice-accent/20 text-[11px] font-mono space-y-1 w-[90%]">
                    <div className="text-[10px] text-ice-accent uppercase font-bold tracking-wider mb-1">
                      Verified Facts:
                    </div>
                    {m.facts.map((f, fIdx) => (
                      <div key={fIdx} className="flex items-center justify-between text-ice-200 border-b border-white/5 pb-0.5">
                        <span className="text-ice-300/70">{f.label || f.key}:</span>
                        <span className="font-semibold text-ice-accent">{f.display}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-ice-300/60 font-mono italic">
                <span className="inline-block w-2 h-2 rounded-full bg-ice-accent animate-ping" />
                Querying twin state and evaluating causal impact…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Prompt Suggestions */}
          <div className="px-4 py-2 border-t border-white/5 bg-ink-950/30 flex gap-1.5 overflow-x-auto text-[11px]">
            {SUGGESTED_PROMPTS.map((p, pIdx) => (
              <button
                key={pIdx}
                onClick={() => handleSend(p)}
                className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-ice-300 hover:text-ice-100 border border-white/5 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="p-3 border-t border-white/10 bg-ink-950/50 flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask a question or describe a what-if scenario for ${stationId.toUpperCase()}…`}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ice-100 placeholder:text-ice-300/40 focus:outline-none focus:border-ice-accent/60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 bg-ice-accent text-ink-950 font-semibold text-xs rounded-xl hover:bg-ice-accent/90 disabled:opacity-40 transition-colors"
            >
              Ask Copilot
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
