import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '../services/api/client.js'
import { loadStationTwin, mergeRefresh } from '../services/twin/loadStationTwin.js'

const DEFAULT_POLL_MS = 30000

// Loads station metadata + overview + assets from the backend for the active
// station and refreshes them periodically. Resets on station switch and
// cancels in-flight requests so a slow response for station A can never
// overwrite station B. Returns { twin, loading, refresh }:
//   twin    StationTwinData for `stationId` (null until the first attempt settles)
//   loading true until the first attempt for this station settles
//   refresh function to trigger an immediate re-fetch
// A failed first attempt yields twin.connection === 'unavailable' (NOT null),
// so the UI can tell "still checking" from "backend down".
export function useStationTwin(stationId, { client = apiClient, pollMs = DEFAULT_POLL_MS } = {}) {
  const [state, setState] = useState({ stationId: null, twin: null })

  const runFetch = useCallback(async (signal) => {
    if (!stationId) return
    const next = await loadStationTwin(client, stationId, { signal })
    setState((prev) => ({
      stationId,
      twin: mergeRefresh(prev.stationId === stationId ? prev.twin : null, next),
    }))
  }, [stationId, client])

  useEffect(() => {
    if (!stationId) {
      setState({ stationId: null, twin: null })
      return undefined
    }
    let cancelled = false
    const controller = new AbortController()
    setState({ stationId, twin: null })

    runFetch(controller.signal)
    const id = setInterval(() => {
      if (!cancelled) runFetch(controller.signal)
    }, pollMs)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(id)
    }
  }, [stationId, runFetch, pollMs])

  const twin = state.twin && state.twin.stationId === stationId ? state.twin : null
  const refresh = useCallback(() => runFetch(), [runFetch])

  return { twin, loading: Boolean(stationId) && twin === null, refresh }
}

