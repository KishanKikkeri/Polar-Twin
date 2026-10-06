import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const STEPS = [
  'Loading station data…',
  'Loading terrain…',
  'Loading infrastructure…',
  'Loading weather service…',
]

export default function LoadingScreen({ onDone }) {
  const [progress, setProgress] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, p + 3 + Math.random() * 6)
        setStepIndex(Math.min(STEPS.length - 1, Math.floor((next / 100) * STEPS.length)))
        if (next >= 100) {
          clearInterval(id)
          setTimeout(onDone, 350)
        }
        return next
      })
    }, 120)
    return () => clearInterval(id)
  }, [onDone])

  return (
    <AnimatePresence>
      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-50 bg-ink-950 flex flex-col items-center justify-center"
      >
        <div className="font-display text-2xl font-semibold tracking-wide text-ice-100">POLARTWIN</div>
        <div className="text-xs text-ice-300/50 mt-1 mb-8 tracking-wide">INITIALIZING ANTARCTIC DIGITAL TWIN…</div>

        <div className="w-64 text-xs text-ice-300/70 mb-1 h-4">{STEPS[stepIndex]}</div>
        <div className="w-64 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-ice-accent to-sky-300 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-ice-accent text-xs mt-2 tick">{Math.floor(progress)}%</div>
      </motion.div>
    </AnimatePresence>
  )
}
