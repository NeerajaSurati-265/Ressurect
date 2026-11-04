import type { LogLine, Pulse } from '@contracts/types'
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
  return (
    <section aria-labelledby="pulse-h" className="mist-glass panel-enter rounded-2xl p-5 sm:p-6">
      <h2 id="pulse-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
        Checking for a pulse…
      </h2>
      <p className="mt-1 text-mist">
        The build worked. We are visiting your app's new address to make sure it answers.{' '}
        <span className="font-semibold text-spectral">
          Attempt <span className="tabular-nums">{attempts}</span> of <span className="tabular-nums">{max}</span>
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
            style={{ filter: 'drop-shadow(0 0 4px rgba(125,226,209,0.8))' }}
          />
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
