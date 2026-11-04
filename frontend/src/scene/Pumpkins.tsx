import { GroundBox } from './Ground'

type PumpkinSpec = { x: number; y: number; size: number; dur: number; delay: number; mobile?: boolean; face: 0 | 1 | 2 }

const PUMPKINS: PumpkinSpec[] = [
  { x: 515, y: 484, size: 1.1, dur: 2.1, delay: 0, mobile: true, face: 0 },
  { x: 872, y: 488, size: 0.85, dur: 2.9, delay: -1.2, mobile: true, face: 1 },
  { x: 1235, y: 482, size: 1, dur: 2.5, delay: -0.6, face: 2 },
]

// Carved faces, drawn around (0, -22) on a ~48 wide pumpkin.
const FACES = [
  'M-14 -30L-6 -30L-10 -38ZM6 -30L14 -30L10 -38ZM-2 -24L2 -24L0 -28ZM-15 -18L-10 -14L-6 -18L-2 -13L2 -18L6 -13L10 -18L15 -14L10 -9L-10 -9Z',
  'M-15 -32L-5 -28L-13 -26ZM15 -32L5 -28L13 -26ZM-14 -18Q0 -6 14 -18L10 -16L7 -12L3 -16L0 -11L-3 -16L-7 -12L-10 -16Z',
  'M-13 -34L-5 -27L-14 -27ZM13 -34L5 -27L14 -27ZM-3 -22L3 -22L0 -26ZM-16 -17L16 -17L13 -10L8 -13L4 -9L0 -13L-4 -9L-8 -13L-13 -10Z',
]

/** 2–3 jack-o'-lanterns whose carved faces glow and flicker in ember tones. */
export function Pumpkins({ mobile }: { mobile: boolean }) {
  const list = PUMPKINS.filter((p) => !mobile || p.mobile)
  return (
    <GroundBox>
      <defs>
        <radialGradient id="pk-body" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#c25a12" />
          <stop offset="60%" stopColor="#7a3309" />
          <stop offset="100%" stopColor="#3a1604" />
        </radialGradient>
        <radialGradient id="pk-fire" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#fff1c9" />
          <stop offset="35%" stopColor="#ffb35c" />
          <stop offset="80%" stopColor="#ff8a1f" />
          <stop offset="100%" stopColor="#b84500" />
        </radialGradient>
        {/* warm light pooling on the ground around each lantern */}
        <radialGradient id="pk-pool">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.42" />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pk-glow">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.45" />
          <stop offset="45%" stopColor="#ff8a1f" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      {list.map((p) => (
        <g key={p.x} transform={`translate(${p.x} ${p.y}) scale(${p.size})`}>
          <ellipse
            cx="0"
            cy="0"
            rx="150"
            ry="20"
            fill="url(#pk-pool)"
            className="anim-ember"
            style={{ animationDuration: `${p.dur * 1.6}s`, animationDelay: `${p.delay}s` }}
          />
          <circle
            cx="0"
            cy="-20"
            r="70"
            fill="url(#pk-glow)"
            className="anim-ember"
            style={{ animationDuration: `${p.dur * 1.3}s`, animationDelay: `${p.delay}s` }}
          />
          <ellipse cx="0" cy="1" rx="30" ry="5" fill="#05060b" />
          <g fill="url(#pk-body)" stroke="#2a1003" strokeWidth="1">
            <ellipse cx="-14" cy="-21" rx="14" ry="20" />
            <ellipse cx="14" cy="-21" rx="14" ry="20" />
            <ellipse cx="0" cy="-22" rx="16" ry="22" />
          </g>
          <path d="M-1 -43Q-2 -52 4 -56L7 -53Q2 -50 3 -43Z" fill="#2f3a19" />
          <path
            d={FACES[p.face]}
            fill="url(#pk-fire)"
            className="anim-ember"
            style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
          />
        </g>
      ))}
    </GroundBox>
  )
}
