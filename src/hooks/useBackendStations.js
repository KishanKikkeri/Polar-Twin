import { useEffect, useState } from 'react'
import { apiClient } from '../services/api/client.js'

// One-shot fetch of GET /api/v1/stations (used for the station selector's
// backend status badges). The 3D layouts/metadata still come from the local
// station config; this only reports what the backend says about each station.
//   status: 'loading' | 'ok' | 'error'
export function useBackendStations({ client = apiClient } = {}) {
  const [state, setState] = useState({ status: 'loading', stations: [], error: null })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    client
      .getStations({ signal: controller.signal })
      .then((stations) => !cancelled && setState({ status: 'ok', stations, error: null }))
      .catch((error) => !cancelled && setState({ status: 'error', stations: [], error }))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [client])

  return state
}
