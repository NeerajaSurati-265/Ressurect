import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { ApiRequestError } from '../api'
import { turnedAwayCopy } from '../lib/copy'

/** Themed message for an API error (4xx / 429 / 503 / network). */
export function TurnedAway({
  error,
  actions,
  autoFocus = true,
}: {
  error: ApiRequestError
  actions?: ReactNode
  autoFocus?: boolean
}) {
  const { headline, detail } = turnedAwayCopy(error.code, error.retry_after_s, error.message)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus()
  }, [autoFocus, error])

  // Show the server's own wording too when it adds something the copy table doesn't.
  const showServer = error.code !== 'internal' && error.message && error.status !== 0

  return (
    <section role="alert" className="mist-glass panel-enter w-full rounded-2xl p-6 text-center sm:p-8">
      <GateIcon />
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 font-display text-2xl font-bold text-moon outline-none sm:text-3xl"
      >
        {headline}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-base text-mist">{detail}</p>
      {showServer && <p className="mx-auto mt-2 max-w-lg text-sm text-mist/80">Server said: {error.message}</p>}
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-mist/70">
        {error.status ? `Error ${error.status} · ${error.code}` : 'Network error'}
      </p>
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </section>
  )
}

/** A closed wrought-iron cemetery gate. */
function GateIcon() {
  return (
    <svg viewBox="0 0 120 80" className="mx-auto h-16 w-24" aria-hidden="true">
      <defs>
        <radialGradient id="gate-glow" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="50" rx="58" ry="30" fill="url(#gate-glow)" />
      <g stroke="#8fa3c7" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M14 76V22M106 76V22" strokeWidth="5" stroke="#4a5574" />
        <path d="M20 30 Q40 14 60 24 Q80 14 100 30" />
        <path d="M20 44H100M20 70H100" />
        {[28, 38, 48, 72, 82, 92].map((x) => (
          <path key={x} d={`M${x} 72V${x < 60 ? 30 - (x - 20) * 0.2 : 30 - (100 - x) * 0.2}`} />
        ))}
        <path d="M60 24V72" />
      </g>
      {/* moon rim on the right-hand edges */}
      <path d="M107.5 76V22M100 30Q80 14 60 24" stroke="#e9ecf5" strokeOpacity="0.25" strokeWidth="0.9" fill="none" />
      {/* chain across the lock */}
      <path d="M44 52Q52 58 55 52M65 52Q68 58 76 52" stroke="#6a7697" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="78" rx="22" ry="2.5" fill="#ff8a1f" opacity="0.18" />
      <g fill="#ffb35c" className="anim-ember">
        <rect x="55" y="48" width="10" height="9" rx="1.5" />
      </g>
      <path d="M57 48v-3a3 3 0 0 1 6 0v3" stroke="#ffb35c" strokeWidth="1.6" fill="none" />
    </svg>
  )
}
