import { useEffect, useRef, useState } from 'react'
import { fetchStationWeather } from '../components/weather/weatherService.js'

const REFRESH_MS = 12 * 60 * 1000 // 12 minutes — well above OpenWeather's free-tier cadence

// Caches the last reading per station so switching back and forth between
// Maitri/Bharati doesn't refetch immediately, and keeps refreshing the
// currently active station on an interval.
export function useStationWeather(stationId, coords) {
  const cache = useRef({})
  const [state, setState] = useState({ loading: true, error: null, data: null })

  useEffect(() => {
    if (!stationId || !coords) return
    let cancelled = false

    async function load() {
      const cached = cache.current[stationId]
      if (cached) {
        setState({ loading: false, error: null, data: cached })
      } else {
        setState((s) => ({ ...s, loading: true }))
      }

      const result = await fetchStationWeather(stationId, coords)
      if (cancelled) return
      cache.current[stationId] = result.data
      setState({ loading: false, error: result.ok ? null : result.reason, data: result.data })
    }

    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [stationId, coords?.lat, coords?.lon])

  return state
}
