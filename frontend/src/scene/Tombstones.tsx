import { GroundBox } from './Ground'

type Kind = 'round' | 'gothic' | 'cross' | 'slab' | 'obelisk' | 'broken' | 'shoulder'
type Stone = { x: number; w: number; h: number; kind: Kind; tilt: number; mobile?: boolean }

const BASE = 478

const STONES: Stone[] = [
  { x: 90, w: 60, h: 96, kind: 'gothic', tilt: -4 },
  { x: 250, w: 70, h: 84, kind: 'round', tilt: 3 },
  { x: 580, w: 44, h: 110, kind: 'cross', tilt: -6, mobile: true },
  { x: 690, w: 74, h: 78, kind: 'slab', tilt: 2, mobile: true },
  { x: 810, w: 52, h: 124, kind: 'obelisk', tilt: 0, mobile: true },
  { x: 935, w: 68, h: 88, kind: 'broken', tilt: -3, mobile: true },
  { x: 1050, w: 62, h: 94, kind: 'shoulder', tilt: 5, mobile: true },
  { x: 1420, w: 66, h: 100, kind: 'round', tilt: -2 },
]

/** Outline of a stone with its base at (0, 0), growing upward. */
function outline({ w, h, kind }: Stone): string {
  const r = w / 2
  switch (kind) {
    case 'round':
      return `M${-r} 0V${-h + r}A${r} ${r} 0 0 1 ${r} ${-h + r}V0Z`
    case 'gothic':
      return `M${-r} 0V${-h * 0.62}Q${-r} ${-h * 0.9} 0 ${-h}Q${r} ${-h * 0.9} ${r} ${-h * 0.62}V0Z`
    case 'cross': {
      const t = w * 0.2
      const arm = h * 0.7
      return `M${-t} 0V${-arm + t}H${-r}V${-arm - t}H${-t}V${-h}H${t}V${-arm - t}H${r}V${-arm + t}H${t}V0Z`
    }
    case 'slab':
      return `M${-r} 0V${-h + 8}L${-r + 8} ${-h}H${r - 8}L${r} ${-h + 8}V0Z`
    case 'obelisk':
      return `M${-r} 0L${-r * 0.62} ${-h * 0.86}L0 ${-h}L${r * 0.62} ${-h * 0.86}L${r} 0Z`
    case 'broken':
      return `M${-r} 0V${-h + r}A${r} ${r} 0 0 1 ${r * 0.2} ${-h + 1}L${r * 0.05} ${-h * 0.8}L${r * 0.45} ${-h * 0.72}L${r * 0.3} ${-h * 0.58}L${r} ${-h * 0.62}V0Z`
    case 'shoulder':
      return `M${-r} 0V${-h * 0.7}Q${-r} ${-h * 0.8} ${-r * 0.55} ${-h * 0.82}Q${-r * 0.4} ${-h} 0 ${-h}Q${r * 0.4} ${-h} ${r * 0.55} ${-h * 0.82}Q${r} ${-h * 0.8} ${r} ${-h * 0.7}V0Z`
  }
}

/** Faint engraved lines; crosses and obelisks get a simple carved mark instead. */
function engraving({ w, h, kind }: Stone): string {
  const r = w / 2
  if (kind === 'cross') return ''
  if (kind === 'obelisk') return `M0 ${-h * 0.62}V${-h * 0.38}M${-r * 0.22} ${-h * 0.54}H${r * 0.22}`
  const top = kind === 'broken' ? -h * 0.5 : -h * 0.58
  return `M${-r * 0.5} ${top}H${r * 0.5}M${-r * 0.36} ${top + 12}H${r * 0.36}M${-r * 0.42} ${top + 24}H${r * 0.42}`
}

/** 8 varied tombstones on a strip of ground (5 on phones). */
export function Tombstones({ mobile }: { mobile: boolean }) {
  const stones = STONES.filter((s) => !mobile || s.mobile)
  return (
    <GroundBox>
      <defs>
        <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#40486a" />
          <stop offset="55%" stopColor="#262b45" />
          <stop offset="100%" stopColor="#14172a" />
        </linearGradient>
        {/* the face away from the moon falls into shadow */}
        <linearGradient id="stone-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#07080f" stopOpacity="0" />
          <stop offset="60%" stopColor="#07080f" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#07080f" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path
        d="M0 470 C 300 455, 600 468, 800 462 C 1050 455, 1300 470, 1600 460 L1600 500 L0 500 Z"
        fill="#07080f"
      />
      {stones.map((s) => (
        <g key={s.x} transform={`translate(${s.x} ${BASE}) rotate(${s.tilt})`}>
          <ellipse cx="0" cy="2" rx={s.w * 0.75} ry="7" fill="#05060b" />
          {/* cold moon rim: a pale copy nudged toward the moon (up-left) peeks out from behind */}
          <path d={outline(s)} fill="#c9d4ec" fillOpacity="0.42" transform="translate(-1.6 -1.4)" />
          <path d={outline(s)} fill="url(#stone)" stroke="#0b0d19" strokeWidth="1.5" />
          <path d={outline(s)} fill="url(#stone-shade)" />
          <path d={engraving(s)} stroke="#0d1020" strokeOpacity="0.75" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      ))}
    </GroundBox>
  )
}
