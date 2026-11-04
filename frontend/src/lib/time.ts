import { useEffect, useState } from 'react'

/** Milliseconds left until `iso`, using the server clock offset. */
export function msUntil(iso: string, clockOffsetMs: number, now = Date.now()): number {
  return Date.parse(iso) - (now + clockOffsetMs)
}

/** mm:ss, never negative. Over an hour shows h:mm:ss. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Re-renders every `intervalMs` while `active`; returns Date.now(). */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs, active])
  return now
}
