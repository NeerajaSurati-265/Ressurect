import { m } from 'framer-motion'
import { GroundBox } from './Ground'

/** Will-o'-the-wisps drifting low between the tombstones (cold, moon-tinted). */
const WISPS = [
  { x: 170, y: 430, dx: 90, dy: -18, dur: 17, delay: 0, mobile: false },
  { x: 640, y: 446, dx: -70, dy: -24, dur: 23, delay: 4, mobile: true },
  { x: 990, y: 438, dx: 80, dy: -14, dur: 19.5, delay: 9, mobile: true },
  { x: 1330, y: 426, dx: -60, dy: -20, dur: 27, delay: 2, mobile: false },
]

/** Sparse embers rising from the jack-o'-lanterns (positions match Pumpkins). */
const EMBERS = [
  { x: 515, y: 456, dur: 4.6, delay: 0.4, mobile: true },
  { x: 520, y: 456, dur: 5.8, delay: 3.1, mobile: true },
  { x: 872, y: 466, dur: 5.2, delay: 1.7, mobile: true },
  { x: 868, y: 466, dur: 6.4, delay: 4.6, mobile: true },
  { x: 1235, y: 458, dur: 5.5, delay: 2.4, mobile: false },
]

export function Wisps({ mobile, paused }: { mobile: boolean; paused: boolean }) {
  if (paused) return null
  const wisps = WISPS.filter((w) => !mobile || w.mobile)
  const embers = EMBERS.filter((e) => !mobile || e.mobile)
  return (
    <GroundBox>
      <defs>
        <radialGradient id="wisp-glow">
          <stop offset="0%" stopColor="#eef3ff" stopOpacity="0.9" />
          <stop offset="30%" stopColor="#c9d4ec" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ember-spark">
          <stop offset="0%" stopColor="#fff1c9" />
          <stop offset="50%" stopColor="#ffb35c" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      {wisps.map((w, i) => (
        <m.circle
          key={`w${i}`}
          cx={w.x}
          cy={w.y}
          r="9"
          fill="url(#wisp-glow)"
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{
            opacity: [0, 0.7, 0.45, 0.75, 0],
            x: [0, w.dx * 0.4, w.dx * 0.7, w.dx],
            y: [0, w.dy, w.dy * 0.3, w.dy * 0.8],
          }}
          transition={{ duration: w.dur, delay: w.delay, repeat: Infinity, ease: 'easeInOut', repeatDelay: 3 + i * 1.3 }}
        />
      ))}
      {embers.map((e, i) => (
        <m.circle
          key={`e${i}`}
          cx={e.x}
          cy={e.y}
          r="2.2"
          fill="url(#ember-spark)"
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0.8, 0], y: [0, -60, -120, -170], x: [0, 6, -4, 8] }}
          transition={{ duration: e.dur, delay: e.delay, repeat: Infinity, ease: 'linear', repeatDelay: 2.5 + i * 0.9 }}
        />
      ))}
    </GroundBox>
  )
}
