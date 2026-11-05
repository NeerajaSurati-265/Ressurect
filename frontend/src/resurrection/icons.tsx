import { m, useReducedMotion } from 'framer-motion'
import { EASE_OUT_EXPO } from '../styles/motion'
import type { Severity } from '@contracts/types'
import { Flame, FlameLight } from '../scene/Flame'

/**
 * Severity seals, engraved like a stamp pressed into the case file:
 * double ring, recessed glyph, a hairline of moonlight on the lower lip.
 * ok = spectral check, warn = ember candle, block = blood cross.
 */
export function SeverityIcon({ severity, className = 'h-6 w-6' }: { severity: Severity; className?: string }) {
  const c = severity === 'ok' ? '#7de2d1' : severity === 'warn' ? '#ffb35c' : '#ff6b70'
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12.5" r="10.2" fill="none" stroke="#e8e1d0" strokeOpacity="0.12" />
      <circle cx="12" cy="12" r="10.2" fill={c} fillOpacity="0.1" stroke={c} strokeOpacity="0.6" strokeWidth="1.1" />
      <circle cx="12" cy="12" r="7.9" fill="none" stroke={c} strokeOpacity="0.28" strokeWidth="0.7" strokeDasharray="1.2 1.4" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {severity === 'ok' && (
          <>
            <path d="M8.2 12.6l2.6 2.6 5-5.6" stroke="#07080f" strokeOpacity="0.6" strokeWidth="2.6" transform="translate(0 0.6)" />
            <path d="M8.2 12.6l2.6 2.6 5-5.6" stroke={c} strokeWidth="1.8" />
          </>
        )}
        {severity === 'warn' && (
          <>
            <path d="M12 6.4c1.3 1.6 1.5 2.7 0 4.3-1.5-1.6-1.3-2.7 0-4.3z" fill={c} stroke="none" />
            <path d="M10 11.6h4v5.2h-4z" stroke={c} strokeWidth="1.3" />
            <path d="M8.6 17.6h6.8" stroke={c} strokeWidth="1.3" />
          </>
        )}
        {severity === 'block' && (
          <>
            <path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" stroke="#07080f" strokeOpacity="0.6" strokeWidth="2.8" transform="translate(0 0.6)" />
            <path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" stroke={c} strokeWidth="1.9" />
          </>
        )}
      </g>
    </svg>
  )
}

export const SEVERITY_LABEL: Record<Severity, string> = { ok: 'OK', warn: 'Warning', block: 'Blocking' }

export function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

/**
 * A séance candle. Bump `flare` (any changing number) to make the flame swell
 * briefly, e.g. when a new log line arrives. Static under reduced motion.
 */
export function Candle({ className = '', delay = 0, flare = 0 }: { className?: string; delay?: number; flare?: number }) {
  const reduced = useReducedMotion()
  const flareAnim =
    reduced || flare === 0
      ? undefined
      : { scale: [1, 1.22, 1], filter: ['brightness(1)', 'brightness(1.35)', 'brightness(1)'] }
  return (
    <svg viewBox="0 0 40 90" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="candle-glow">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.55" />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="candle-wax" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f3ecdb" />
          <stop offset="60%" stopColor="#d9c9a3" />
          <stop offset="100%" stopColor="#9c8a64" />
        </linearGradient>
      </defs>
      <m.g
        key={flare}
        animate={flareAnim}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO, times: [0, 0.25, 1] }}
        style={{ transformBox: 'fill-box', transformOrigin: '50% 80%' }}
      >
      {/* layered flame from the realism pass; seed keeps the two candles out of step */}
      <FlameLight x={20} y={16} rx={20} ry={18} seed={Math.round(Math.abs(delay) * 7) + 1} strength={0.35} />
      <Flame x={20} y={23} scale={0.7} seed={Math.round(Math.abs(delay) * 7) + 1} />
      </m.g>
      <path d="M20 23v4" stroke="#2a2418" strokeWidth="1.4" />
      <path d="M12 28h16v54H12z" fill="url(#candle-wax)" />
      <path d="M12 28c2 0 3 6 5 6s2-6 4-6 3 9 5 9 2-9 2-9" fill="#f3ecdb" />
      <path d="M6 84h28" stroke="#2a2418" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Original rune glyphs for the five ritual phases (summon, clone, install, build, upload).
 * Drawn as single-stroke marks on a 24 grid.
 */
export const RUNES = [
  'M12 3v18M12 8l-5-4M12 8l5-4M8 21h8', // summon: a forked staff
  'M7 4v16M17 4v16M7 12h10', // clone: twin pillars joined
  'M12 3l7 9-7 9-7-9zM12 8v8', // install: the seed in the lozenge
  'M5 20L12 4l7 16M8 14h8', // build: the raised gable
  'M12 21V5M6 11l6-6 6 6M6 17l6-6 6 6', // upload: the rising arrows
] as const

export function Rune({ index, className = 'h-6 w-6' }: { index: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={RUNES[index % RUNES.length]} />
    </svg>
  )
}
