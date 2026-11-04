import { useEffect, useRef, useSyncExternalStore } from 'react'

function subscribeQuery(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeQuery(query),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
export const useIsMobile = () => useMediaQuery('(max-width: 639.98px)')
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)')

/**
 * Runs `cb` on requestAnimationFrame, throttled to `fps`. Browsers pause rAF in
 * hidden tabs, so this costs nothing in the background.
 */
export function useFrameLoop(cb: (now: number) => void, fps: number, active: boolean) {
  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })
  useEffect(() => {
    if (!active) return
    const interval = 1000 / fps
    let last = -Infinity
    let id = 0
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (now - last < interval - 1) return
      last = now
      cbRef.current(now)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [fps, active])
}

/** Small deterministic PRNG so procedural art is identical on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
