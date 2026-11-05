import type { CSSProperties } from 'react'
import { MOON_BOX } from './layout'

type Ray = { angle: number; spread: number; length: number; alpha: number; dur: number; delay: number }

/** Shafts fan down and to the right from the moon, through the trees. */
const RAYS: Ray[] = [
  { angle: 24, spread: 16, length: 150, alpha: 0.075, dur: 23, delay: -4 },
  { angle: 34, spread: 24, length: 140, alpha: 0.06, dur: 31, delay: -17 },
  { angle: 47, spread: 18, length: 125, alpha: 0.065, dur: 27, delay: -9 },
  { angle: 58, spread: 28, length: 110, alpha: 0.05, dur: 37, delay: -22 },
]

/**
 * 3-4 soft moonlight shafts. Each is a pre-blurred SVG wedge inside its own div, so the slow
 * opacity/angle drift is a compositor-only animation (no re-raster). Mount the layer with
 * mix-blend-mode: screen. Under reduced motion the shafts are static and dimmer (CSS).
 */
export function GodRays({ mobile }: { mobile: boolean }) {
  const rays = mobile ? RAYS.slice(0, 3) : RAYS
  return (
    <div
      className="absolute"
      style={{
        left: `calc(${MOON_BOX.left} + ${MOON_BOX.width} / 2)`,
        top: `calc(${MOON_BOX.top} + ${MOON_BOX.width} / 2)`,
        width: 0,
        height: 0,
      }}
    >
      {rays.map((r, i) => (
        <div
          key={i}
          className="god-ray"
          style={
            {
              width: `${r.length}vmax`,
              height: `${r.spread}vmax`,
              marginTop: `${-r.spread / 2}vmax`,
              '--ray-a': `${r.angle}deg`,
              '--ray-o': r.alpha,
              animationDuration: `${r.dur}s`,
              animationDelay: `${r.delay}s`,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
            <defs>
              <linearGradient id={`ray-g${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#dfe7f8" stopOpacity="0" />
                <stop offset="10%" stopColor="#dfe7f8" stopOpacity="1" />
                <stop offset="35%" stopColor="#c9d4ec" stopOpacity="0.5" />
                <stop offset="70%" stopColor="#8fa3c7" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
              </linearGradient>
              <filter id={`ray-f${i}`} x="-5%" y="-40%" width="110%" height="180%">
                <feGaussianBlur stdDeviation="22 16" />
              </filter>
            </defs>
            <polygon points="0,97 1000,22 1000,178 0,103" fill={`url(#ray-g${i})`} filter={`url(#ray-f${i})`} />
          </svg>
        </div>
      ))}
    </div>
  )
}
