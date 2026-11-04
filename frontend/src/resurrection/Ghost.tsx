import { m, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { emitFrom } from '../fx/particles'
import { float } from '../styles/motion'

/**
 * An original spirit: a soft, translucent sheet with a scalloped hem and two ember
 * eyes. It drifts up out of the tombstone, then bobs gently.
 */
export function Ghost() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const idle = float(5, 7, 3)
  useEffect(() => {
    if (reduce) return
    const ts = [700, 1150, 1600].map((d, i) =>
      window.setTimeout(() => emitFrom(ref.current, 'smoke', { at: i === 0 ? 'bottom' : 'center', count: 6, spread: 30 }), d),
    )
    return () => ts.forEach((t) => window.clearTimeout(t))
  }, [reduce])
  return (
    <m.div
      ref={ref}
      className="pointer-events-none absolute left-1/2 top-0 z-0 w-[46%] -translate-x-1/2"
      initial={reduce ? { opacity: 0 } : { y: '70%', opacity: 0, scale: 0.6, filter: 'blur(14px)' }}
      animate={reduce ? { opacity: 1 } : { y: '0%', opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={reduce ? { duration: 0.6 } : { type: 'spring', stiffness: 40, damping: 12, mass: 1.2, delay: 0.7, filter: { duration: 1.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 1.4, delay: 0.7 } }}
    >
      <m.div animate={reduce ? undefined : idle.animate} transition={idle.transition}>
      <svg viewBox="0 0 120 150" className="block w-full overflow-visible" aria-hidden="true">
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
        {/* faint trailing wisp under the hem */}
        <m.path
          d="M52 136C48 150 58 158 54 172M68 137C72 152 64 160 69 176"
          stroke="#c9d4ec"
          strokeOpacity="0.22"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          filter="url(#ghost-eye-glow)"
          animate={reduce ? undefined : { opacity: [0.5, 1, 0.6, 0.9, 0.5], x: [0, 2, -1.5, 1, 0] }}
          transition={{ duration: 9.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <path
          d="M60 8C30 8 16 34 16 70V136Q24 126 33 137Q41 127 50 138Q60 127 70 138Q79 127 87 137Q96 126 104 136V70C104 34 90 8 60 8Z"
          fill="url(#ghost-sheet)"
          filter="url(#ghost-soft)"
        />
        {/* soft fold shadows */}
        <path d="M40 60C36 86 38 112 42 132M80 60C84 86 82 112 78 132" stroke="#8fa3c7" strokeOpacity="0.25" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* ember eyes open last */}
        <m.g
          initial={reduce ? { opacity: 0 } : { scaleY: 0.05, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scaleY: [0.05, 1, 1, 0.1, 1], opacity: 1 }}
          transition={reduce ? { duration: 0.4, delay: 0.6 } : { delay: 2.3, duration: 1.1, times: [0, 0.3, 0.7, 0.82, 1], opacity: { delay: 2.3, duration: 0.2 } }}
          style={{ transformOrigin: '60px 52px', transformBox: 'view-box' }}
        >
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
        </m.g>
      </svg>
      </m.div>
    </m.div>
  )
}
