import { m, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { emitFrom } from '../fx/particles'
import { float } from '../styles/motion'

// Crown and shoulders, flaring into the body (the ragged hem is a separate shape so it can trail).
const BODY =
  'M58 10C46 10 38 19 37 32C36 42 33 49 28 58C22 70 20 88 19 104L18 120L102 120L101 102C100 86 97 70 91 58C86 49 83 41 82 31C81 18 71 10 58 10Z'
// Torn hem: uneven, sharp tatters of different lengths.
const HEM =
  'M18 114L16 128L21 123L19 144L27 127L30 150L36 129L41 143L46 128L52 152L56 130L61 141L66 129L72 150L77 128L83 142L88 126L95 147L97 125L104 138L102 114Z'

/**
 * An original spirit: a translucent, cold-tinted form, dense at the crown and fraying into a torn
 * hem, with mist moving inside it and two pale eye hollows. No hands, no face features beyond the
 * hollows. It drifts up out of the tombstone, then bobs gently.
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
      className="pointer-events-none absolute left-1/2 top-0 z-0 w-[46%] -translate-x-1/2 will-change-transform"
      initial={reduce ? { opacity: 0 } : { y: '70%', opacity: 0, scale: 0.6, filter: 'blur(14px)' }}
      animate={reduce ? { opacity: 1 } : { y: '0%', opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={reduce ? { duration: 0.6 } : { type: 'spring', stiffness: 40, damping: 12, mass: 1.2, delay: 0.7, filter: { duration: 1.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 1.4, delay: 0.7 } }}
    >
      <m.div animate={reduce ? undefined : idle.animate} transition={idle.transition}>
      <svg viewBox="0 0 120 150" className="block w-full overflow-visible" aria-hidden="true">
        <defs>
          {/* cold, translucent: dense at the crown, thinning to nothing at the torn hem */}
          <linearGradient id="ghost-sheet" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="150">
            <stop offset="0%" stopColor="#eef5ff" stopOpacity="0.74" />
            <stop offset="30%" stopColor="#cfdcf3" stopOpacity="0.5" />
            <stop offset="70%" stopColor="#a3b8de" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8fa6cf" stopOpacity="0" />
          </linearGradient>
          {/* the side away from the moon falls into a cooler shade */}
          <linearGradient id="ghost-shade" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="104" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#3a4a78" stopOpacity="0.35" />
          </linearGradient>
          <radialGradient id="ghost-aura">
            <stop offset="0%" stopColor="#b8cdf0" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#9fb7e0" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#9fb7e0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ghost-mist-light">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ghost-mist-dark">
            <stop offset="0%" stopColor="#2c3a66" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2c3a66" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ghost-hollow">
            <stop offset="0%" stopColor="#0b1024" stopOpacity="0.7" />
            <stop offset="65%" stopColor="#1b2444" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#3a4a78" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ghost-eye-cold">
            <stop offset="0%" stopColor="#e8f6ff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#bfe3ff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="ghost-form">
            <path d={BODY} />
            <path d={HEM} />
          </clipPath>
          <filter id="ghost-eye-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <ellipse cx="60" cy="66" rx="68" ry="82" fill="url(#ghost-aura)" />
        {/* faint trailing wisps under the hem */}
        <m.path
          d="M44 132C40 150 50 160 45 176M66 136C70 152 61 162 67 180M84 130C88 144 82 154 86 166"
          stroke="#c9d6f0"
          strokeOpacity="0.16"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
          filter="url(#ghost-eye-glow)"
          animate={reduce ? undefined : { opacity: [0.5, 1, 0.6, 0.9, 0.5], x: [0, 2, -1.5, 1, 0] }}
          transition={{ duration: 9.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <path d={BODY} fill="url(#ghost-sheet)" />
        <path d={HEM} fill="url(#ghost-sheet)" className="ghost-hem" />
        {/* mist turning slowly inside the form */}
        <g clipPath="url(#ghost-form)">
          <path d={BODY} fill="url(#ghost-shade)" />
          <ellipse cx="46" cy="78" rx="22" ry="30" fill="url(#ghost-mist-light)" className="ghost-mist" />
          <ellipse cx="76" cy="104" rx="20" ry="26" fill="url(#ghost-mist-dark)" className="ghost-mist" style={{ animationDelay: '-3s', animationDuration: '11s' }} />
          <ellipse cx="58" cy="34" rx="16" ry="14" fill="url(#ghost-mist-light)" className="ghost-mist" style={{ animationDelay: '-6s', animationDuration: '13s' }} />
          {/* folds falling from the crown */}
          <path d="M40 60C34 84 36 106 31 130M80 60C86 84 85 106 90 128M57 64C55 90 59 114 56 140" stroke="#56689a" strokeOpacity="0.18" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
        {/* moonlight along the crown and shoulder facing the moon */}
        <path d="M37.5 40C37 22 46 11.5 58 11" stroke="#f7faff" strokeOpacity="0.4" strokeWidth="1" fill="none" strokeLinecap="round" />
        {/* pale, cold eye hollows open last */}
        <m.g
          initial={reduce ? { opacity: 0 } : { scaleY: 0.05, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scaleY: [0.05, 1, 1, 0.1, 1], opacity: 1 }}
          transition={reduce ? { duration: 0.4, delay: 0.6 } : { delay: 2.3, duration: 1.1, times: [0, 0.3, 0.7, 0.82, 1], opacity: { delay: 2.3, duration: 0.2 } }}
          style={{ transformOrigin: '58px 37px', transformBox: 'view-box' }}
        >
          <ellipse cx="49" cy="37" rx="3.8" ry="5.6" fill="url(#ghost-hollow)" transform="rotate(8 49 37)" />
          <ellipse cx="67.5" cy="37" rx="3.8" ry="5.6" fill="url(#ghost-hollow)" transform="rotate(-8 67.5 37)" />
          <ellipse cx="49.3" cy="38" rx="1.3" ry="1.9" fill="url(#ghost-eye-cold)" />
          <ellipse cx="67.2" cy="38" rx="1.3" ry="1.9" fill="url(#ghost-eye-cold)" />
        </m.g>
      </svg>
      </m.div>
    </m.div>
  )
}
