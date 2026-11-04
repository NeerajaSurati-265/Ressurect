import { useRef } from 'react'
import { useFrameLoop } from './hooks'

type FogSpec = {
  bottom: string
  height: string
  alpha: number
  /** seconds to drift one viewport width; negative drifts right */
  period: number
  start: number
}

const LAYERS: FogSpec[] = [
  { bottom: '18%', height: '30vh', alpha: 0.05, period: 260, start: 12 },
  { bottom: '8%', height: '28vh', alpha: 0.07, period: -190, start: 30 },
  { bottom: '0%', height: '26vh', alpha: 0.09, period: 140, start: 4 },
  { bottom: '-6%', height: '22vh', alpha: 0.11, period: -100, start: 22 },
]

function fogBackground(a: number) {
  const c = (k: number) => `rgba(143,163,199,${(a * k).toFixed(3)})`
  // Each tile is half the element's width; blobs stay inside the tile so the loop is seamless.
  return [
    `radial-gradient(ellipse 17% 42% at 18% 62%, ${c(1)}, transparent 70%)`,
    `radial-gradient(ellipse 20% 36% at 48% 70%, ${c(0.85)}, transparent 70%)`,
    `radial-gradient(ellipse 16% 46% at 80% 58%, ${c(1)}, transparent 70%)`,
    `radial-gradient(ellipse 48% 30% at 50% 92%, ${c(0.7)}, transparent 75%)`,
  ].join(',')
}

/**
 * Four soft fog bands. Each band is 200% wide and made of two identical tiles,
 * so translating by -50% loops seamlessly. Drift is driven at 30 fps.
 */
export function GroundFog({ reduced }: { reduced: boolean }) {
  const refs = useRef<(HTMLDivElement | null)[]>([])

  useFrameLoop(
    (now) => {
      const t = now / 1000
      LAYERS.forEach((l, i) => {
        const el = refs.current[i]
        if (!el) return
        const pct = (((t / l.period) * 50 + l.start) % 50 + 50) % 50
        el.style.transform = `translate3d(${(-pct).toFixed(3)}%,0,0)`
      })
    },
    30,
    !reduced,
  )

  return (
    <div className="absolute inset-0 overflow-hidden">
      {LAYERS.map((l, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="absolute left-0"
          style={{
            bottom: l.bottom,
            height: l.height,
            width: '200%',
            backgroundImage: fogBackground(l.alpha),
            backgroundSize: '50% 100%',
            backgroundRepeat: 'repeat-x',
            transform: `translate3d(${-l.start}%,0,0)`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  )
}
