import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '../services/api/client.js'

/**
 * Hook to continuously monitor backend /health endpoint.
 *
 * Exposes:
 * - status: 'checking' | 'ok' | 'degraded' | 'unavailable'
 * - health: HealthResponse object from backend
 * - latencyMs: roundtrip time in ms
 * - lastChecked: timestamp
 * - error: error message if unavailable
 * - refresh: function to trigger immediate check
 */
export function useBackendHealth({ client = apiClient, pollMs = 15000 } = {}) {
  const [state, setState] = useState({
    status: 'checking',
    health: null,
    latencyMs: null,
    lastChecked: null,
    error: null,
  })

  const check = useCallback(async (signal) => {
    const start = Date.now()
    try {
      const body = await client.getHealth({ signal })
      const latency = Date.now() - start
      setState({
        status: body?.status === 'ok' ? 'ok' : 'degraded',
        health: body,
        latencyMs: latency,
        lastChecked: new Date(),
        error: null,
      })
    } catch (err) {
      setState({
        status: 'unavailable',
        health: null,
        latencyMs: null,
        lastChecked: new Date(),
        error: err.message || 'Backend unreachable',
      })
    }
  }, [client])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    check(controller.signal)
    const id = setInterval(() => {
      if (!cancelled) check(controller.signal)
    }, pollMs)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(id)
    }
  }, [check, pollMs])

  return { ...state, refresh: () => check() }
}
