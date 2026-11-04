import { GroundBox } from './Ground'

/**
 * Three rolling hill silhouettes. Aerial perspective: the farthest ridge is the
 * lightest and bluest, each nearer ridge darker and crisper.
 */
export function Hills() {
  return (
    <GroundBox>
      <defs>
        <linearGradient id="hill-farthest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b3566" />
          <stop offset="100%" stopColor="#1a2046" />
        </linearGradient>
        <linearGradient id="hill-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c2349" />
          <stop offset="100%" stopColor="#11152e" />
        </linearGradient>
        <linearGradient id="hill-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c9d4ec" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#c9d4ec" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#c9d4ec" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path
        d="M0 300 C 140 262, 300 278, 470 262 C 640 246, 760 222, 930 248 C 1110 276, 1300 236, 1600 262 L1600 500 L0 500 Z"
        fill="url(#hill-farthest)"
        opacity="0.75"
      />
      <path
        d="M0 330 C 200 270, 380 300, 560 285 C 760 268, 900 240, 1080 275 C 1260 305, 1420 258, 1600 290 L1600 500 L0 500 Z"
        fill="url(#hill-far)"
      />
      {/* moonlit ridge line, brightest on the side facing the moon (left) */}
      <path
        d="M0 330 C 200 270, 380 300, 560 285 C 760 268, 900 240, 1080 275 C 1260 305, 1420 258, 1600 290"
        fill="none"
        stroke="url(#hill-rim)"
        strokeWidth="1.6"
      />
      <path
        d="M0 410 C 220 380, 420 400, 640 395 C 860 390, 1000 372, 1200 392 C 1380 410, 1500 395, 1600 405 L1600 500 L0 500 Z"
        fill="#0a0c1c"
      />
      <path
        d="M0 410 C 220 380, 420 400, 640 395 C 860 390, 1000 372, 1200 392"
        fill="none"
        stroke="url(#hill-rim)"
        strokeWidth="1.2"
        opacity="0.6"
      />
    </GroundBox>
  )
}
