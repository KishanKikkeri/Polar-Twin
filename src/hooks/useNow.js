import { useEffect, useState } from 'react'

// Re-renders on an interval and returns the current epoch ms, so freshness
// (CURRENT -> STALE) updates even when no new backend data arrives.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
