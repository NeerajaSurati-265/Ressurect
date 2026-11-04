import { m } from 'framer-motion'

/**
 * An original spirit: a soft, translucent sheet with a scalloped hem and two ember
 * eyes. It drifts up out of the tombstone, then bobs gently.
 */
export function Ghost() {
  return (
    <m.div
      className="pointer-events-none absolute left-1/2 top-0 z-0 w-[46%] -translate-x-1/2"
      initial={{ y: '95%', opacity: 0 }}
      animate={{ y: '0%', opacity: 1 }}
      transition={{ duration: 2, delay: 0.9, ease: [0.25, 0.7, 0.3, 1] }}
    >
      <svg viewBox="0 0 120 150" className="anim-bob block w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="ghost-sheet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eef2fb" stopOpacity="0.92" />
            <stop offset="55%" stopColor="#c9d4ec" stopOpacity="0.62" />
            <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0.08" />
          </linearGradient>
          <radialGradient id="ghost-aura">
            <stop offset="0%" stopColor="#c9d4ec" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#c9d4ec" stopOpacity="0" />
          </radialGradient>
          <filter id="ghost-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <filter id="ghost-eye-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <ellipse cx="60" cy="70" rx="70" ry="80" fill="url(#ghost-aura)" />
        <path
          d="M60 8C30 8 16 34 16 70V136Q24 126 33 137Q41 127 50 138Q60 127 70 138Q79 127 87 137Q96 126 104 136V70C104 34 90 8 60 8Z"
          fill="url(#ghost-sheet)"
          filter="url(#ghost-soft)"
        />
        {/* soft fold shadows */}
        <path d="M40 60C36 86 38 112 42 132M80 60C84 86 82 112 78 132" stroke="#8fa3c7" strokeOpacity="0.25" strokeWidth="3" fill="none" strokeLinecap="round" />
        <g className="anim-ember-slow">
          <g filter="url(#ghost-eye-glow)" fill="#ff8a1f" opacity="0.9">
            <ellipse cx="47" cy="52" rx="6" ry="7.5" />
            <ellipse cx="73" cy="52" rx="6" ry="7.5" />
          </g>
          <ellipse cx="47" cy="52" rx="3.6" ry="5" fill="#ffb35c" />
          <ellipse cx="73" cy="52" rx="3.6" ry="5" fill="#ffb35c" />
          <ellipse cx="47" cy="51" rx="1.4" ry="2" fill="#fff1c9" />
          <ellipse cx="73" cy="51" rx="1.4" ry="2" fill="#fff1c9" />
        </g>
      </svg>
    </m.div>
  )
}
