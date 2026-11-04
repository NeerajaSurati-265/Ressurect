import { m, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { formatClock, msUntil, useNow } from '../lib/time'

/** A deploy lives for 20 minutes; the candle's wax is tied to the share left. */
const LIFETIME_MS = 20 * 60_000
const WAX_TOP = 30
const WAX_BOTTOM = 92

/**
 * A candle that burns down beside the clock. `frac` is 1 when freshly lit, 0 when spent.
 * Under two minutes the flame gutters and turns blood red. Static under reduced motion.
 */
function BurningCandle({ frac, urgent }: { frac: number; urgent: boolean }) {
  const reduced = useReducedMotion()
  const f = Math.min(1, Math.max(0.04, frac))
  const height = (WAX_BOTTOM - WAX_TOP) * f
  const top = WAX_BOTTOM - height
  const flame = urgent ? '#e5484d' : '#ffb35c'
  const core = urgent ? '#ffc2c4' : '#fff1c9'
  const glow = urgent ? 'rgba(229,72,77,0.3)' : 'rgba(255,138,31,0.3)'
  const ease = [0.16, 1, 0.3, 1] as const
  return (
    <svg viewBox="0 0 40 100" className="h-20 w-8 shrink-0 sm:h-24 sm:w-10" aria-hidden="true">
      <defs>
        <linearGradient id="cd-wax" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f3ecdb" />
          <stop offset="60%" stopColor="#d9c9a3" />
          <stop offset="100%" stopColor="#8a7a58" />
        </linearGradient>
        <radialGradient id="cd-glow">
          <stop offset="0%" stopColor={glow} />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* wax column: height follows the time left */}
      <m.rect
        x="13"
        width="14"
        rx="1.5"
        fill="url(#cd-wax)"
        initial={false}
        animate={{ y: top, height }}
        transition={{ duration: reduced ? 0 : 1, ease }}
      />
      {/* an occasional drip down the moonlit side */}
      {!reduced && (
        <m.ellipse
          cx="25.5"
          rx="1.3"
          ry="2"
          fill="#efe6cf"
          initial={{ opacity: 0, cy: top + 2 }}
          animate={{ opacity: [0, 1, 1, 0], cy: [top + 2, top + 4, top + 16, top + 18] }}
          transition={{ duration: 3.2, times: [0, 0.15, 0.85, 1], ease: 'easeIn', repeat: Infinity, repeatDelay: 7.5 }}
        />
      )}
      <m.g initial={false} animate={{ y: top - WAX_TOP }} transition={{ duration: reduced ? 0 : 1, ease }}>
        <circle cx="20" cy="18" r="17" fill="url(#cd-glow)" />
        <path d="M20 26v4" stroke="#2a2418" strokeWidth="1.4" />
        <m.g
          style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
          animate={
            reduced
              ? undefined
              : urgent
                ? { scaleY: [1, 0.72, 0.9, 0.62, 1], scaleX: [1, 1.1, 0.95, 1.12, 1], rotate: [0, -6, 3, 5, 0] }
                : { scaleY: [1, 1.06, 0.97, 1.03, 1], rotate: [0, 1.5, -1, 1, 0] }
          }
          transition={{ duration: urgent ? 2.3 : 3.7, ease: 'easeInOut', repeat: Infinity }}
        >
          <path d="M20 9c4 5 5 9 0 17-5-8-4-12 0-17z" fill={flame} style={{ transition: 'fill 600ms' }} />
          <path d="M20 15c2 3 2.2 5 0 9-2.2-4-2-6 0-9z" fill={core} style={{ transition: 'fill 600ms' }} />
        </m.g>
      </m.g>
      <path d="M7 94h26" stroke="#2a2418" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Counts down to expires_at on the server's clock. Under 2:00 the digits turn
 * blood red and pulse. Calls onExpire once when it reaches 0:00.
 */
export function Countdown({
  expiresAt,
  pinned,
  clockOffsetMs,
  onExpire,
}: {
  expiresAt: string | null
  pinned: boolean
  clockOffsetMs: number
  onExpire?: () => void
}) {
  const eternal = pinned || !expiresAt
  const now = useNow(250, !eternal)
  const left = eternal ? Infinity : msUntil(expiresAt!, clockOffsetMs, now)
  const fired = useRef(false)

  useEffect(() => {
    if (!eternal && left <= 0 && !fired.current) {
      fired.current = true
      onExpire?.()
    }
  }, [eternal, left, onExpire])

  if (eternal) {
    return (
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Lifetime</p>
        <p className="countdown-digits mt-1 font-display text-5xl font-bold text-ember-300 sm:text-6xl">Eternal</p>
        <p className="mt-1 text-sm text-mist">This one is pinned and will not expire.</p>
      </div>
    )
  }

  const urgent = left < 120_000
  const minutesLeft = Math.max(0, Math.ceil(left / 60_000))
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Returns to the grave in</p>
      <div className="mt-1 flex items-end justify-center gap-3">
      <BurningCandle frac={left / LIFETIME_MS} urgent={urgent} />
      <p
        role="timer"
        aria-label={`${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} left`}
        className={`countdown-digits font-display text-5xl font-bold tabular-nums sm:text-6xl ${urgent ? 'countdown-urgent text-blood' : 'text-ember-300'}`}
      >
        {formatClock(left)}
      </p>
      </div>
      <p className="mt-1 text-sm text-mist">
        {left <= 0 ? 'Time is up.' : urgent ? 'Less than two minutes left. Grab your screenshots.' : 'After that the files are deleted.'}
      </p>
    </div>
  )
}
