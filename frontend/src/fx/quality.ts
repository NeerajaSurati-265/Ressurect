/**
 * Runtime quality guard. Watches frame times; if the rolling average stays above ~25 ms for 3 s
 * it switches to light effects once (one-way): the WebGL fog falls back to CSS fog and particle
 * counts are halved. Paused while the tab is hidden; never runs under reduced motion.
 */
export type Quality = 'high' | 'low'

const SLOW_MS = 25
const SUSTAIN_MS = 3000

let quality: Quality = 'high'
let started = false
const listeners = new Set<(q: Quality) => void>()

export function getQuality(): Quality {
  return quality
}

export function onQuality(fn: (q: Quality) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Force light effects (also used by the guard itself). */
export function degrade(reason = 'low frame rate') {
  if (quality === 'low') return
  quality = 'low'
  console.info(`[resurrect] ${reason}, switching to light effects`)
  listeners.forEach((l) => {
    try {
      l(quality)
    } catch {
      /* ignore */
    }
  })
}

/** Start the monitor once (from Layout). Safe to call repeatedly. */
export function startQualityGuard() {
  if (started || typeof window === 'undefined') return
  started = true
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  let last = 0
  let avg = 16.7
  let slowSince = 0
  let raf = 0
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick)
    if (last) {
      const dt = t - last
      // ignore long gaps (tab switches, debugger pauses)
      if (dt < 250) {
        avg = avg * 0.9 + dt * 0.1
        if (avg > SLOW_MS) {
          if (!slowSince) slowSince = t
          else if (t - slowSince >= SUSTAIN_MS) {
            degrade()
            cancelAnimationFrame(raf)
            return
          }
        } else slowSince = 0
      }
    }
    last = t
  }
  const onVis = () => {
    if (document.visibilityState === 'hidden') {
      cancelAnimationFrame(raf)
      raf = 0
    } else if (quality === 'high' && !raf) {
      last = 0
      slowSince = 0
      raf = requestAnimationFrame(tick)
    }
  }
  document.addEventListener('visibilitychange', onVis)
  if (document.visibilityState !== 'hidden') raf = requestAnimationFrame(tick)
}
