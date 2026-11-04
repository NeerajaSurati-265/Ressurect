import { useEffect, useRef } from 'react'
import { formatClock, msUntil, useNow } from '../lib/time'

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
      <p
        role="timer"
        aria-label={`${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} left`}
        className={`countdown-digits mt-1 font-display text-5xl font-bold tabular-nums sm:text-6xl ${urgent ? 'countdown-urgent text-blood' : 'text-ember-300'}`}
      >
        {formatClock(left)}
      </p>
      <p className="mt-1 text-sm text-mist">
        {left <= 0 ? 'Time is up.' : urgent ? 'Less than two minutes left. Grab your screenshots.' : 'After that the files are deleted.'}
      </p>
    </div>
  )
}
