import { useId } from 'react'
import { Flame, FlameLight } from './Flame'
import { GroundBox } from './Ground'
import { PUMPKINS } from './layout'

// Small, restrained carvings around (0, -22) on a ~50 wide pumpkin.
const FACES = [
  'M-11 -28L-5 -27.5L-8.5 -33ZM5 -27.5L11 -28L8.5 -33ZM-12 -16Q0 -9 12 -16Q9 -12.5 6 -13L4 -11L1 -12.6L-2 -11L-5 -13Q-9 -12.5 -12 -16Z',
  'M-12 -27Q-8 -31.5 -4 -27Q-8 -25.4 -12 -27ZM4 -27Q8 -31.5 12 -27Q8 -25.4 4 -27ZM-11 -15Q0 -6.5 11 -15Q0 -11 -11 -15Z',
  'M-11 -30L-4 -26L-11 -26ZM11 -30L4 -26L11 -26ZM-13 -16L13 -16Q11 -11 7 -11L5 -13.5L2 -11L-2 -11L-5 -13.5L-7 -11Q-11 -11 -13 -16Z',
]

/**
 * 2-3 carved pumpkins lit from inside by a real <Flame/> seen through the cuts. The same seed drives
 * the warm spill on the soil and on nearby stones, so everything brightens and dims together.
 * No SVG filters here: the flames animate, so this SVG repaints and must stay cheap.
 */
export function Pumpkins({ mobile }: { mobile: boolean }) {
  const uid = `pk${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const list = PUMPKINS.filter((p) => !mobile || p.mobile)
  return (
    <GroundBox className="fx-own-layer">
      <defs>
        <radialGradient id={`${uid}-lobe`} cx="34%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#c8651d" />
          <stop offset="45%" stopColor="#8f3e0d" />
          <stop offset="100%" stopColor="#331303" />
        </radialGradient>
        <radialGradient id={`${uid}-lobe-out`} cx="30%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#9c4710" />
          <stop offset="55%" stopColor="#5e2607" />
          <stop offset="100%" stopColor="#220c02" />
        </radialGradient>
        {/* the inside of the shell, lit by the candle */}
        <radialGradient id={`${uid}-inside`} cx="50%" cy="80%" r="75%">
          <stop offset="0%" stopColor="#ffd98a" />
          <stop offset="45%" stopColor="#f28a24" />
          <stop offset="100%" stopColor="#8a320a" />
        </radialGradient>
        {list.map((p) => (
          <clipPath key={p.x} id={`${uid}-face${p.face}`}>
            <path d={FACES[p.face]} />
          </clipPath>
        ))}
        <clipPath id={`${uid}-body`}>
          <ellipse cx="-17" cy="-19.5" rx="10" ry="18.5" />
          <ellipse cx="17" cy="-19.5" rx="10" ry="18.5" />
          <ellipse cx="0" cy="-21" rx="17" ry="21" />
        </clipPath>
      </defs>
      {list.map((p) => (
        <g key={p.x}>
          {/* warm light pooled on the soil and thrown up onto nearby stones */}
          <FlameLight x={p.x} y={p.y} rx={150 * p.size} ry={20 * p.size} seed={p.seed} strength={0.34} />
          <FlameLight x={p.x} y={p.y - 34 * p.size} rx={115 * p.size} ry={70 * p.size} seed={p.seed} strength={0.1} />
          <g transform={`translate(${p.x} ${p.y}) scale(${p.size})`}>
            <ellipse cx="3" cy="1" rx="28" ry="4.5" fill="#030409" opacity="0.85" />
            <ellipse cx="-17" cy="-19.5" rx="10" ry="18.5" fill={`url(#${uid}-lobe-out)`} />
            <ellipse cx="17" cy="-19.5" rx="10" ry="18.5" fill={`url(#${uid}-lobe-out)`} />
            <ellipse cx="-9.5" cy="-20.5" rx="13" ry="20.5" fill={`url(#${uid}-lobe)`} />
            <ellipse cx="9.5" cy="-20.5" rx="13" ry="20.5" fill={`url(#${uid}-lobe)`} opacity="0.92" />
            <ellipse cx="0" cy="-21" rx="12" ry="21" fill={`url(#${uid}-lobe)`} />
            {/* ribs between the lobes */}
            <path
              d="M-5.5 -41Q-9 -21 -5.5 -1M5.5 -41Q9 -21 5.5 -1M-13.5 -37.5Q-20 -20 -13.5 -2.5M13.5 -37.5Q20 -20 13.5 -2.5"
              stroke="#260d02"
              strokeOpacity="0.6"
              strokeWidth="1.1"
              fill="none"
            />
            {/* candlelight glowing through the thin shell around the cuts */}
            <g clipPath={`url(#${uid}-body)`}>
              <FlameLight x={0} y={-19} rx={20} ry={16} seed={p.seed} strength={0.38} color="#ff9a3a" />
            </g>
            {/* cold moon rim on the upper left */}
            <path d="M-25 -22Q-24 -36 -10 -41.5" stroke="#c9d4ec" strokeOpacity="0.22" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <path d="M-1 -41Q-2.5 -49 2.5 -53.5L5.5 -51.5Q1.5 -48 2.6 -41.5Z" fill="#2a3317" />
            {/* the carving: flesh wall, the lit inside, then the flame seen through the cut */}
            <path d={FACES[p.face]} fill="#5c2106" transform="translate(0.6 0.7)" />
            <g clipPath={`url(#${uid}-face${p.face})`}>
              <rect x="-16" y="-36" width="32" height="30" fill={`url(#${uid}-inside)`} />
              <Flame x={0} y={-8} scale={1.25} seed={p.seed} intensity={1.2} />
            </g>
            <circle cx="0" cy="-22" r="6" fill="none" data-fog-ember={0.75 * p.size} />
          </g>
        </g>
      ))}
    </GroundBox>
  )
}
