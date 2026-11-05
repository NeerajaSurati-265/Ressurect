import { GroundBox } from './Ground'

const FARTHEST = 'M0 300 C 140 262, 300 278, 470 262 C 640 246, 760 222, 930 248 C 1110 276, 1300 236, 1600 262 L1600 500 L0 500 Z'
const FAR = 'M0 330 C 200 270, 380 300, 560 285 C 760 268, 900 240, 1080 275 C 1260 305, 1420 258, 1600 290 L1600 500 L0 500 Z'
const FAR_RIDGE = 'M0 330 C 200 270, 380 300, 560 285 C 760 268, 900 240, 1080 275 C 1260 305, 1420 258, 1600 290'
const NEAR = 'M0 410 C 220 380, 420 400, 640 395 C 860 390, 1000 372, 1200 392 C 1380 410, 1500 395, 1600 405 L1600 500 L0 500 Z'
const NEAR_RIDGE = 'M0 410 C 220 380, 420 400, 640 395 C 860 390, 1000 372, 1200 392 C 1380 410, 1500 395, 1600 405'

/**
 * Three rolling ridges with aerial perspective: the farthest is lightest, bluest, lowest in
 * contrast and softest (depth of field), each nearer ridge darker and crisper. Each is lit from
 * the moon (upper left): a horizontal light falloff, a silver rim on the ridge line and a faint
 * turbulence texture of moonlit grass and hollows. Static, so the filters rasterise once.
 */
export function Hills() {
  return (
    <GroundBox>
      <defs>
        <linearGradient id="hill-farthest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#323d70" />
          <stop offset="60%" stopColor="#222a58" />
          <stop offset="100%" stopColor="#1a2046" />
        </linearGradient>
        <linearGradient id="hill-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e264f" />
          <stop offset="100%" stopColor="#10142c" />
        </linearGradient>
        <linearGradient id="hill-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0e1126" />
          <stop offset="100%" stopColor="#07080f" />
        </linearGradient>
        {/* moonlight falls off away from the moon (left -> right) */}
        <linearGradient id="hill-moonside" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b9c7e6" stopOpacity="0.14" />
          <stop offset="45%" stopColor="#b9c7e6" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#05060d" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="hill-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d3dcf0" stopOpacity="0.42" />
          <stop offset="50%" stopColor="#c9d4ec" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#c9d4ec" stopOpacity="0.04" />
        </linearGradient>
        {/* soft moonlit patches and darker hollows, then depth-of-field blur */}
        {[
          { id: 'hill-tex-farthest', blur: 1.6, freq: '0.004 0.02', amt: 0.1 },
          { id: 'hill-tex-far', blur: 1.1, freq: '0.006 0.03', amt: 0.12 },
          { id: 'hill-tex-near', blur: 0.6, freq: '0.01 0.05', amt: 0.14 },
        ].map((f) => (
          <filter key={f.id} id={f.id} x="0" y="-5%" width="100%" height="110%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={f.freq} numOctaves="3" seed="6" result="n" />
            <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0.72  0 0 0 0 0.78  0 0 0 0 0.92  ${4 * f.amt} 0 0 0 ${-1.6 * f.amt}`} result="lit" />
            <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0.02  0 0 0 0 0.02  0 0 0 0 0.05  ${-4 * f.amt} 0 0 0 ${2.4 * f.amt}`} result="hollow" />
            <feMerge result="m">
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="lit" />
              <feMergeNode in="hollow" />
            </feMerge>
            <feComposite in="m" in2="SourceAlpha" operator="in" result="c" />
            <feGaussianBlur in="c" stdDeviation={f.blur} />
          </filter>
        ))}
        <filter id="hill-rim-blur" x="0" y="-50%" width="100%" height="200%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>
      <g filter="url(#hill-tex-farthest)" opacity="0.78">
        <path d={FARTHEST} fill="url(#hill-farthest)" />
        <path d={FARTHEST} fill="url(#hill-moonside)" />
      </g>
      <g filter="url(#hill-tex-far)">
        <path d={FAR} fill="url(#hill-far)" />
        <path d={FAR} fill="url(#hill-moonside)" />
      </g>
      {/* moonlit ridge line, brightest on the side facing the moon (left) */}
      <path d={FAR_RIDGE} fill="none" stroke="url(#hill-rim)" strokeWidth="1.8" filter="url(#hill-rim-blur)" />
      <g filter="url(#hill-tex-near)">
        <path d={NEAR} fill="url(#hill-near)" />
        <path d={NEAR} fill="url(#hill-moonside)" opacity="0.7" />
      </g>
      <path d={NEAR_RIDGE} fill="none" stroke="url(#hill-rim)" strokeWidth="1.3" opacity="0.65" />
    </GroundBox>
  )
}
