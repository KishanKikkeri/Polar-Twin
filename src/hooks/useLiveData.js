import { useEffect, useRef, useState } from 'react'

// Simulated live-data engine. Ticks every few seconds and nudges values
// by a small random amount so the interface feels like a live digital twin.
// NOTE: all values are synthetic — Maitri does not expose a live sensor feed
// to this prototype.
function jitter(value, amount) {
  return value + (Math.random() - 0.5) * 2 * amount
}

export function useLiveData() {
  const [live, setLive] = useState({
    outsideTempC: -18.0,
    windKmh: 24,
    visibilityKm: 8.4,
    electricityLoadKw: 82,
    electricityKwhToday: 428,
    fuelPct: 72.4,
    waterPct: 84,
    heatingLoadPct: 68,
    lastUpdate: new Date(),
  })

  const tickRef = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current += 1
      setLive((prev) => ({
        outsideTempC: Number(jitter(prev.outsideTempC, 0.25).toFixed(1)),
        windKmh: Math.max(0, Number(jitter(prev.windKmh, 1.5).toFixed(1))),
        visibilityKm: Math.max(0.5, Number(jitter(prev.visibilityKm, 0.3).toFixed(1))),
        electricityLoadKw: Math.max(40, Number(jitter(prev.electricityLoadKw, 2).toFixed(1))),
        electricityKwhToday: Number((prev.electricityKwhToday + Math.random() * 0.6).toFixed(1)),
        fuelPct: Math.max(0, Number((prev.fuelPct - Math.random() * 0.01).toFixed(2))),
        waterPct: Math.max(0, Math.min(100, Number(jitter(prev.waterPct, 0.4).toFixed(1)))),
        heatingLoadPct: Math.max(0, Math.min(100, Number(jitter(prev.heatingLoadPct, 1.2).toFixed(1)))),
        lastUpdate: new Date(),
      }))
    }, 3500)
    return () => clearInterval(id)
  }, [])

  return live
}
