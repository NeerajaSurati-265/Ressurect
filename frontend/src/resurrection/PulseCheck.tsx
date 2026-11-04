import type { LogLine, Pulse } from '@contracts/types'
import { m, useReducedMotion } from 'framer-motion'
import { useEffect, type Ref } from 'react'
import { keeperEvent } from '../keeper/store'

const BEAT =
  'M0 40H70L80 40L88 18L98 62L108 8L118 52L124 40H200L210 40L218 18L228 62L238 8L248 52L254 40H330L340 40L348 18L358 62L368 8L378 52L384 40H460'

/** Sweep timing shared by the stroke and the pen tip: 2.2 s cycle, eased travel over the first 70 %. */
const CYCLE_MS = 2200
/** Where the three R-peaks sit along BEAT, as fractions of its length. */
const PEAKS = [0.2327, 0.5394, 0.846]

/** Inverse of the pen's keySpline (0.42 0 0.58 1): when, in the cycle, the tip reaches each peak. */
function peakTimes() {
  const bez = (p1: number, p2: number, u: number) => 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u
  return PEAKS.map((f) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (bez(0, 1, mid) < f) lo = mid
      else hi = mid
    }
    return bez(0.42, 0.58, lo) * 0.7 * CYCLE_MS
  })
}

/** Tells the Keeper each time the pen passes a heartbeat spike, so its flame pulses in time. */
function useHeartbeatCue(active: boolean) {
  useEffect(() => {
    if (!active) return
    const times = peakTimes()
    const start = performance.now()
    let lastPhase = 0
    const id = window.setInterval(() => {
      const phase = (performance.now() - start) % CYCLE_MS
      for (const t of times) {
        const crossed = lastPhase <= phase ? lastPhase < t && t <= phase : t > lastPhase || t <= phase
        if (crossed) keeperEvent('beat')
      }
      lastPhase = phase
    }, 30)
    return () => window.clearInterval(id)
  }, [active])
}

/** "Checking for a pulse… attempt N of M" with a heartbeat line sweeping across. */
export function PulseCheck({
  pulse,
  lastLine,
  headingRef,
}: {
  pulse: Pulse | null
  lastLine: LogLine | null
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const attempts = pulse?.attempts ?? 1
  const max = pulse?.max_attempts ?? 20
  const reduced = useReducedMotion()
  useHeartbeatCue(!reduced)
  return (
    <section aria-labelledby="pulse-h" className="mist-glass panel-enter rounded-2xl p-5 sm:p-6">
      <h2 id="pulse-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
        Checking for a pulse…
      </h2>
      <p className="mt-1 text-mist">
        The build worked. We are visiting your app's new address to make sure it answers.{' '}
        <span className="font-semibold text-spectral">
          Attempt{' '}
          <m.span
            key={attempts}
            className="inline-block tabular-nums"
            initial={reduced ? false : { scale: 1.28, opacity: 0.55 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, mass: 0.8 }}
          >
            {attempts}
          </m.span> of <span className="tabular-nums">{max}</span>
        </span>
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-spectral/20 bg-night-950/70 py-3">
        <svg viewBox="0 0 460 70" preserveAspectRatio="none" className="block h-16 w-full" aria-hidden="true">
          <path d="M0 40H460" stroke="#7de2d1" strokeOpacity="0.12" strokeWidth="1" />
          <path d={BEAT} fill="none" stroke="#7de2d1" strokeOpacity="0.18" strokeWidth="2" strokeLinejoin="round" />
          <path
            d={BEAT}
            fill="none"
            stroke="#7de2d1"
            strokeWidth="2.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={100}
            className="heartbeat-sweep"
            style={{ filter: 'drop-shadow(0 0 3px rgba(125,226,209,0.6))' }}
          />
          {/* the glowing pen tip, riding the same eased 2.2 s sweep as the stroke above */}
          {!reduced && (
            <g>
              <circle r="7" fill="#7de2d1" fillOpacity="0.16" />
              <circle r="3.2" fill="#7de2d1" fillOpacity="0.45" />
              <circle r="1.6" fill="#e9ecf5" />
              <animateMotion
                dur="2.2s"
                repeatCount="indefinite"
                path={BEAT}
                calcMode="spline"
                keyPoints="0;1;1"
                keyTimes="0;0.7;1"
                keySplines="0.42 0 0.58 1;0 0 1 1"
              />
              <animate attributeName="opacity" dur="2.2s" repeatCount="indefinite" values="1;1;0" keyTimes="0;0.7;1" />
            </g>
          )}
        </svg>
      </div>
      {lastLine && (
        <p className="mt-3 break-words font-type text-sm text-mist">
          <span className="sr-only">Latest check: </span>
          {lastLine.text}
        </p>
      )}
    </section>
  )
}
