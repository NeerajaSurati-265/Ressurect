import type { LogLine, Pulse } from '@contracts/types'
import { m, useReducedMotion } from 'framer-motion'
import type { Ref } from 'react'

const BEAT =
  'M0 40H70L80 40L88 18L98 62L108 8L118 52L124 40H200L210 40L218 18L228 62L238 8L248 52L254 40H330L340 40L348 18L358 62L368 8L378 52L384 40H460'

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
