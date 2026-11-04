import { m, useAnimationControls, useReducedMotion, type Transition } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { emit } from '../fx/particles'
import { SPRING } from '../styles/motion'
import { Ghost } from './Ghost'

export type GraveMode = 'rest' | 'split' | 'shut' | 'haunted' | 'grey'

const STONE = 'M50 232V110A70 70 0 0 1 190 110V232Z'
// jagged crack from the crown to the base
const CRACK = [
  [120, 38],
  [113, 66],
  [127, 94],
  [115, 126],
  [125, 158],
  [114, 194],
  [121, 232],
]
const crackPts = CRACK.map(([x, y]) => `${x},${y}`).join(' ')
const LEFT_CLIP = `0,0 120,0 ${crackPts} 121,260 0,260`
const RIGHT_CLIP = `120,0 240,0 240,260 121,260 ${[...CRACK].reverse().map(([x, y]) => `${x},${y}`).join(' ')}`

const OPEN_L = { rotate: -15, x: -34, y: 8 }
const OPEN_R = { rotate: 13, x: 34, y: 6 }
const CLOSED = { rotate: 0, x: 0, y: 0 }

function fitName(name: string) {
  const text = name.length > 22 ? `${name.slice(0, 21)}…` : name
  // Cinzel caps are wide; shrink to fit ~118 units of stone.
  const size = Math.max(8, Math.min(20, 150 / Math.max(1, text.length)))
  return { text, size }
}

function Face({ name, owner, mode }: { name: string; owner: string; mode: GraveMode }) {
  const { text, size } = fitName(name.toUpperCase())
  const engrave = mode === 'grey' ? '#1a1c24' : '#0b0d19'
  return (
    <>
      <path d={STONE} fill={mode === 'grey' ? 'url(#grave-stone-grey)' : 'url(#grave-stone)'} stroke="#0b0d19" strokeWidth="2" />
      {/* cold moon rim light on the upper-left edge */}
      <path d="M52 200V110A68 68 0 0 1 150 48" fill="none" stroke="#c9d4ec" strokeOpacity="0.28" strokeWidth="1.6" />
      <path d="M62 112A58 58 0 0 1 178 112V220H62Z" fill="none" stroke="#0b0d19" strokeOpacity="0.45" strokeWidth="1.5" />
      <g fontFamily="Cinzel, 'Times New Roman', serif" textAnchor="middle" fontWeight="700">
        <text x="120" y="96" fontSize="10" letterSpacing="3" fill={engrave} fillOpacity="0.85">
          HERE LIES
        </text>
        <text x="120" y="97" fontSize="10" letterSpacing="3" fill="#c9d4ec" fillOpacity="0.12" dy="1">
          HERE LIES
        </text>
        <text x="120" y="140" fontSize={size} fill="#c9d4ec" fillOpacity="0.16" dy="1.2">
          {text}
        </text>
        <text x="120" y="140" fontSize={size} fill={engrave}>
          {text}
        </text>
        <text x="120" y="166" fontSize="9" letterSpacing="1.5" fill={engrave} fillOpacity="0.8" fontWeight="600">
          {owner.length > 24 ? `${owner.slice(0, 23)}…` : owner}
        </text>
      </g>
      <path d="M92 190H148M100 202H140" stroke={engrave} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      {mode === 'grey' && (
        <path d="M150 60L140 92L152 110L138 140" fill="none" stroke="#090a10" strokeWidth="2.2" strokeLinecap="round" />
      )}
      {mode === 'shut' && (
        <g fill="#5d7a4b" fillOpacity="0.75">
          <ellipse cx="66" cy="228" rx="18" ry="6" />
          <ellipse cx="170" cy="229" rx="22" ry="5" />
          <ellipse cx="56" cy="214" rx="6" ry="9" />
          <ellipse cx="183" cy="212" rx="5" ry="11" />
        </g>
      )}
    </>
  )
}

/**
 * The resurrection's tombstone, engraved with the repo name. It rises out of the
 * ground on first load while the fog parts, then reacts to the status.
 */
export function Grave({ name, owner, mode }: { name: string; owner: string; mode: GraveMode }) {
  const reduce = useReducedMotion()
  const open = mode === 'split'
  const startOpen = mode === 'shut' // expired: start split and slide shut
  // split timeline (s): shudder 0-0.7, crack glows 0.7-1.1, halves fall 1.1+, light 1.2+
  const halfTransition: Transition = reduce
    ? { duration: 0.01 }
    : open
      ? { type: 'spring', stiffness: 70, damping: 11, mass: 1.3, delay: 1.1 }
      : { duration: 1.3, ease: [0.3, 0.7, 0.2, 1], delay: 0.5 }
  const wrapRef = useRef<HTMLDivElement>(null)
  const shake = useAnimationControls()
  const stone = useAnimationControls()

  // rise from the earth: sink (anticipation), heave up with overshoot, dirt + a small camera shake on settle
  useEffect(() => {
    let cancelled = false
    const el = wrapRef.current
    const base = () => {
      const r = el?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.88, w: r.width } : null
    }
    if (reduce) {
      stone.set({ y: 0, opacity: 1 })
      return
    }
    stone.set({ y: 230, opacity: 0.2 })
    // Safety net: if the rise is interrupted or stalls, the stone still ends up standing.
    let settled = false
    const safety = window.setTimeout(() => {
      if (!settled) stone.set({ y: 0, opacity: 1 })
    }, 2500)
    ;(async () => {
      await stone.start({ y: 236, opacity: 0.4, transition: { duration: 0.18, ease: 'easeIn' } })
      if (cancelled) return
      const b = base()
      if (b) emit('dirt', { x: b.x, y: b.y, count: 26, spread: b.w * 0.35 })
      const t = window.setTimeout(() => {
        const b2 = base()
        if (b2 && !cancelled) emit('dirt', { x: b2.x, y: b2.y, count: 18, spread: b2.w * 0.3 })
        if (!cancelled) shake.start({ x: [0, -3, 3, -2, 1.5, 0], y: [0, 2, -1.5, 1, 0, 0], transition: { duration: 0.3, ease: 'easeOut' } })
      }, 520)
      await stone.start({ y: 0, opacity: 1, transition: { ...SPRING.heavy, opacity: { duration: 0.4 } } })
      settled = true
      window.clearTimeout(t)
    })()
    return () => {
      cancelled = true
      window.clearTimeout(safety)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the split: shudder twice, then the halves fall and spirit motes pour out
  useEffect(() => {
    if (!open || reduce) return
    const timers: number[] = []
    timers.push(
      window.setTimeout(() => {
        stone.start({ x: [0, -2.5, 2.5, -2, 0, 0, 0, -3, 3, -1.5, 0], transition: { duration: 0.7, ease: 'easeInOut' } })
      }, 120),
    )
    const motes = (count: number) => () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (r) emit('spirit-mote', { x: r.left + r.width / 2, y: r.top + r.height * 0.55, count, spread: r.width * 0.18 })
    }
    timers.push(window.setTimeout(motes(22), 1150), window.setTimeout(motes(16), 1500), window.setTimeout(motes(12), 1900))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [open, reduce, stone])

  return (
    <m.div ref={wrapRef} animate={shake} className={`relative mx-auto w-full max-w-[300px] ${mode === 'haunted' ? 'pt-[38%]' : ''}`}>
      {mode === 'haunted' && <Ghost />}
      <svg viewBox="0 0 240 260" className="relative z-10 block w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="grave-stone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5a6488" />
            <stop offset="45%" stopColor="#363d5e" />
            <stop offset="100%" stopColor="#191c31" />
          </linearGradient>
          <linearGradient id="grave-stone-grey" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5b5e66" />
            <stop offset="55%" stopColor="#3b3d44" />
            <stop offset="100%" stopColor="#202127" />
          </linearGradient>
          <radialGradient id="grave-burst" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stopColor="#f2fffc" stopOpacity="0.95" />
            <stop offset="25%" stopColor="#7de2d1" stopOpacity="0.7" />
            <stop offset="65%" stopColor="#7de2d1" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#7de2d1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="grave-fog">
            <stop offset="0%" stopColor="#8fa3c7" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="grave-column" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f2fffc" stopOpacity="0.85" />
            <stop offset="35%" stopColor="#7de2d1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#7de2d1" stopOpacity="0" />
          </linearGradient>
          <filter id="grave-crack-glow" x="-50%" y="-20%" width="200%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id="grave-above-ground">
            <rect x="-60" y="-200" width="360" height="434" />
          </clipPath>
          <clipPath id="grave-left">
            <polygon points={LEFT_CLIP} />
          </clipPath>
          <clipPath id="grave-right">
            <polygon points={RIGHT_CLIP} />
          </clipPath>
        </defs>

        {/* spectral light pouring out of the split */}
        {open && (
          <m.ellipse
            cx="120"
            cy="140"
            rx="150"
            ry="170"
            fill="url(#grave-burst)"
            initial={{ opacity: 0, scale: 0.2 }}
            animate={reduce ? { opacity: 0.75, scale: 1 } : { opacity: [0, 1, 0.75], scale: [0.2, 1.15, 1] }}
            transition={reduce ? { duration: 0.6 } : { duration: 1.4, delay: 1.15, times: [0, 0.4, 1] }}
            style={{ transformOrigin: '120px 150px' }}
          />
        )}
        {open && (
          <m.rect
            x="92"
            y="-260"
            width="56"
            height="492"
            rx="28"
            fill="url(#grave-column)"
            initial={{ opacity: 0, scaleY: 0, scaleX: 0.4 }}
            animate={{ opacity: 0.8, scaleY: 1, scaleX: 1 }}
            transition={reduce ? { duration: 0.6 } : { duration: 1.3, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: '120px 232px', transformBox: 'view-box' }}
          />
        )}

        <g clipPath="url(#grave-above-ground)">
          <m.g initial={reduce ? false : { y: 230, opacity: 0.2 }} animate={stone}>
            <m.g
              clipPath="url(#grave-left)"
              initial={startOpen ? OPEN_L : CLOSED}
              animate={open ? OPEN_L : CLOSED}
              transition={halfTransition}
              style={{ transformOrigin: '60px 232px' }}
            >
              <Face name={name} owner={owner} mode={mode} />
            </m.g>
            <m.g
              clipPath="url(#grave-right)"
              initial={startOpen ? OPEN_R : CLOSED}
              animate={open ? OPEN_R : CLOSED}
              transition={halfTransition}
              style={{ transformOrigin: '180px 232px' }}
            >
              <Face name={name} owner={owner} mode={mode} />
            </m.g>
            {mode !== 'split' && mode !== 'shut' && (
              <polyline points={crackPts} fill="none" stroke="#0b0d19" strokeOpacity="0.35" strokeWidth="1" />
            )}
            {open && !reduce && (
              <m.g
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.1, delay: 0.7, times: [0, 0.35, 0.7, 1] }}
              >
                <polyline points={crackPts} fill="none" stroke="#7de2d1" strokeWidth="6" filter="url(#grave-crack-glow)" />
                <polyline points={crackPts} fill="none" stroke="#f2fffc" strokeWidth="1.6" strokeLinejoin="bevel" />
              </m.g>
            )}
          </m.g>
        </g>

        {/* freshly turned earth */}
        <path d="M18 236C50 222 96 226 120 225C150 224 196 222 224 236C200 244 40 244 18 236Z" fill="#07080f" />
        <path d="M24 234C60 226 180 224 218 234" fill="none" stroke="#8fa3c7" strokeOpacity="0.14" strokeWidth="1.2" />

        {/* fog parts as the stone rises */}
        <m.ellipse
          cx="92"
          cy="228"
          rx="80"
          ry="22"
          fill="url(#grave-fog)"
          initial={{ x: 30, opacity: 1 }}
          animate={{ x: -50, opacity: 0.55 }}
          transition={{ duration: 2.2, ease: 'easeOut' }}
        />
        <m.ellipse
          cx="150"
          cy="230"
          rx="84"
          ry="20"
          fill="url(#grave-fog)"
          initial={{ x: -30, opacity: 1 }}
          animate={{ x: 52, opacity: 0.55 }}
          transition={{ duration: 2.2, ease: 'easeOut' }}
        />
      </svg>
    </m.div>
  )
}
