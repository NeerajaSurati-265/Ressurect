import { useMemo } from 'react'
import { GroundBox } from './Ground'
import { mulberry32 } from './hooks'
import { StoneFilterDefs } from './stoneFilters'
import { useStoneIds } from './stoneIds'

type Kind = 'round' | 'gothic' | 'cross' | 'slab' | 'obelisk' | 'broken' | 'shoulder'
type Stone = {
  x: number
  w: number
  h: number
  kind: Kind
  tilt: number
  /** 0..1 how far moss has climbed */
  moss?: number
  crack?: boolean
  /** extra sink into the soil (older stones settle) */
  sink?: number
  mobile?: boolean
}

/** Ground line the stones stand on. The parallax layer overscans 24 px, so keep it well above 476. */
export const STONE_BASE = 452
const SINK = 9

const STONES: Stone[] = [
  { x: 90, w: 60, h: 96, kind: 'gothic', tilt: -4, moss: 0.5 },
  { x: 250, w: 70, h: 84, kind: 'round', tilt: 3, crack: true, sink: 4 },
  { x: 580, w: 44, h: 110, kind: 'cross', tilt: -6, moss: 0.3, mobile: true },
  { x: 690, w: 74, h: 78, kind: 'slab', tilt: 2, moss: 0.7, sink: 3, mobile: true },
  { x: 810, w: 52, h: 124, kind: 'obelisk', tilt: 0, mobile: true },
  { x: 935, w: 68, h: 88, kind: 'broken', tilt: -3, moss: 0.4, mobile: true },
  { x: 1050, w: 62, h: 94, kind: 'shoulder', tilt: 5, crack: true, mobile: true },
  { x: 1420, w: 66, h: 100, kind: 'round', tilt: -2, moss: 0.55 },
]

/** Outline of a stone with its base at (0, 0), growing upward; `below` extends it into the soil. */
function outline({ w, h, kind }: Stone, below = SINK): string {
  const r = w / 2
  const b = below
  switch (kind) {
    case 'round':
      return `M${-r} ${b}V${-h + r}A${r} ${r} 0 0 1 ${r} ${-h + r}V${b}Z`
    case 'gothic':
      return `M${-r} ${b}V${-h * 0.62}Q${-r} ${-h * 0.9} 0 ${-h}Q${r} ${-h * 0.9} ${r} ${-h * 0.62}V${b}Z`
    case 'cross': {
      const t = w * 0.2
      const arm = h * 0.7
      return `M${-t} ${b}V${-arm + t}H${-r}V${-arm - t}H${-t}V${-h}H${t}V${-arm - t}H${r}V${-arm + t}H${t}V${b}Z`
    }
    case 'slab':
      return `M${-r} ${b}V${-h + 8}L${-r + 8} ${-h}H${r - 8}L${r} ${-h + 8}V${b}Z`
    case 'obelisk':
      return `M${-r} ${b}L${-r * 0.62} ${-h * 0.86}L0 ${-h}L${r * 0.62} ${-h * 0.86}L${r} ${b}Z`
    case 'broken':
      return `M${-r} ${b}V${-h + r}A${r} ${r} 0 0 1 ${r * 0.2} ${-h + 1}L${r * 0.05} ${-h * 0.8}L${r * 0.45} ${-h * 0.72}L${r * 0.3} ${-h * 0.58}L${r} ${-h * 0.62}V${b}Z`
    case 'shoulder':
      return `M${-r} ${b}V${-h * 0.7}Q${-r} ${-h * 0.8} ${-r * 0.55} ${-h * 0.82}Q${-r * 0.4} ${-h} 0 ${-h}Q${r * 0.4} ${-h} ${r * 0.55} ${-h * 0.82}Q${r} ${-h * 0.8} ${r} ${-h * 0.7}V${b}Z`
  }
}

/** Worn inscription lines; crosses and obelisks get a simple carved mark instead. */
function engraving({ w, h, kind }: Stone): string {
  const r = w / 2
  if (kind === 'cross') return `M0 ${-h * 0.84}V${-h * 0.58}`
  if (kind === 'obelisk') return `M0 ${-h * 0.62}V${-h * 0.38}M${-r * 0.22} ${-h * 0.54}H${r * 0.22}`
  const top = kind === 'broken' ? -h * 0.5 : -h * 0.58
  // uneven lengths read as words worn down
  return `M${-r * 0.5} ${top}H${r * 0.12}M${r * 0.22} ${top}H${r * 0.5}M${-r * 0.36} ${top + 11}H${r * 0.36}M${-r * 0.42} ${top + 21}H${-r * 0.02}M${r * 0.08} ${top + 21}H${r * 0.42}`
}

function crackPath({ w, h }: Stone): string {
  const r = w / 2
  return `M${r * 0.15} ${-h * 0.96}L${r * 0.02} ${-h * 0.8}L${r * 0.3} ${-h * 0.66}L${r * 0.12} ${-h * 0.5}L${r * 0.36} ${-h * 0.38}`
}

/** Grass blades as one filled path: tapered quadratic slivers. */
function grass(seed: number, x0: number, x1: number, y: number, n: number, hMin: number, hMax: number, wobble: number) {
  const rand = mulberry32(seed)
  let d = ''
  for (let i = 0; i < n; i++) {
    // tufts: clusters of 3-6 blades
    const cx = x0 + rand() * (x1 - x0)
    const blades = 3 + Math.floor(rand() * 4)
    for (let b = 0; b < blades; b++) {
      const bx = cx + (rand() - 0.5) * 10
      const by = y + (rand() - 0.5) * wobble
      const h = hMin + rand() * (hMax - hMin)
      const lean = (rand() - 0.5) * h * 0.7
      const w = 0.9 + rand() * 1.3
      const tx = bx + lean
      const ty = by - h
      d += `M${(bx - w).toFixed(1)} ${by.toFixed(1)}Q${(bx - w * 0.3 + lean * 0.4).toFixed(1)} ${(by - h * 0.55).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}Q${(bx + w * 0.4 + lean * 0.45).toFixed(1)} ${(by - h * 0.5).toFixed(1)} ${(bx + w).toFixed(1)} ${by.toFixed(1)}Z`
    }
  }
  return d
}

/** An uneven earth line from x 0..1600 around `y`. */
function earth(seed: number, y: number, amp: number, step = 40) {
  const rand = mulberry32(seed)
  let d = `M-20 ${y}`
  for (let x = 20; x <= 1640; x += step) {
    const yy = y + (rand() - 0.5) * amp * 2
    d += `Q${x - step / 2} ${(yy + (rand() - 0.5) * amp).toFixed(1)} ${x} ${yy.toFixed(1)}`
  }
  return `${d}L1640 520L-20 520Z`
}

/**
 * 8 weathered tombstones seated in layered earth (5 on phones). Carved and lit by the shared
 * stone filters; the whole SVG is static so the filters rasterise once.
 */
export function Tombstones({ mobile }: { mobile: boolean }) {
  const ids = useStoneIds('ts')
  const stones = STONES.filter((s) => !mobile || s.mobile)
  const art = useMemo(
    () => ({
      back: earth(5, STONE_BASE - 10, 4),
      mid: earth(9, STONE_BASE + 4, 3, 60),
      midLip: earth(9, STONE_BASE + 4, 3, 60).split('L1640')[0],
      backGrass: grass(17, 0, 1600, STONE_BASE - 8, 70, 6, 14, 6),
      frontGrass: grass(31, 0, 1600, STONE_BASE + 8, 90, 8, 20, 8),
    }),
    [],
  )
  return (
    <GroundBox>
      <StoneFilterDefs ids={ids} seed={3} />
      <defs>
        {/* base colour: lit upper left (moon side), aerial-blue in the light, near-black in shade */}
        <linearGradient id={`${ids.carve}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4a536f" />
          <stop offset="50%" stopColor="#2b3048" />
          <stop offset="100%" stopColor="#151827" />
        </linearGradient>
        <linearGradient id={`${ids.carve}-shade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#05060b" stopOpacity="0" />
          <stop offset="55%" stopColor="#05060b" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#05060b" stopOpacity="0.5" />
        </linearGradient>
        {/* moss may grow up from the soil, thinning with height */}
        <linearGradient id={`${ids.moss}-fade`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${ids.soil}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#141829" />
          <stop offset="40%" stopColor="#0b0d18" />
          <stop offset="100%" stopColor="#05060b" />
        </linearGradient>
        <linearGradient id={`${ids.soil}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b0d17" />
          <stop offset="100%" stopColor="#030408" />
        </linearGradient>
        {stones.map((s, i) => (
          <clipPath key={s.x} id={`${ids.carve}-clip${i}`}>
            <path d={outline(s)} />
          </clipPath>
        ))}
      </defs>

      {/* back earth with its moonlit lip and a far fringe of grass */}
      <path d={art.back} fill={`url(#${ids.soil}-fill)`} filter={`url(#${ids.soil})`} />
      <path d={art.backGrass} fill="#151a2e" />

      {stones.map((s, i) => (
        <g key={s.x} transform={`translate(${s.x} ${STONE_BASE + (s.sink ?? 0)}) rotate(${s.tilt})`}>
          {/* contact shadow, offset away from the moon */}
          <ellipse cx={s.w * 0.18} cy="3" rx={s.w * 0.8} ry="6" fill="#030409" opacity="0.8" />
          {/* faint cold backlight peeking out on the moon side */}
          <path d={outline(s)} fill="#c9d4ec" fillOpacity="0.16" transform="translate(-1.4 -1.2)" />
          <g filter={`url(#${ids.carve})`}>
            <path d={outline(s)} fill={`url(#${ids.carve}-fill)`} />
            {/* the face turned away from the moon falls into shadow */}
            <path d={outline(s)} fill={`url(#${ids.carve}-shade)`} />
            {s.moss ? (
              <g clipPath={`url(#${ids.carve}-clip${i})`}>
                <rect
                  x={-s.w / 2 - 4}
                  y={-s.h * s.moss}
                  width={s.w + 8}
                  height={s.h * s.moss + SINK}
                  fill={`url(#${ids.moss}-fade)`}
                  filter={`url(#${ids.moss})`}
                  opacity="0.6"
                />
              </g>
            ) : null}
            <path
              d={engraving(s)}
              stroke="#000"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
              filter={`url(#${ids.engrave})`}
            />
            {s.crack && (
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d={crackPath(s)} stroke="#c9d4ec" strokeOpacity="0.22" strokeWidth="1.1" transform="translate(0.8 0.8)" />
                <path d={crackPath(s)} stroke="#06070d" strokeWidth="1.4" />
              </g>
            )}
          </g>
        </g>
      ))}

      {/* soil seated against the stone bases, then the nearer earth and its grass */}
      <path d={art.mid} fill={`url(#${ids.soil}-front)`} filter={`url(#${ids.soil})`} />
      <path d={art.midLip} fill="none" stroke="#8fa3c7" strokeOpacity="0.1" strokeWidth="1" />
      <path d={art.frontGrass} fill="#07080f" />
    </GroundBox>
  )
}
