import { LazyMotion, domAnimation, m } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

type Flight = { id: number; xs: number[]; ys: number[]; duration: number; scale: number; ltr: boolean; flap: number }

let nextId = 1

function makeFlight(): Flight {
  const w = window.innerWidth
  const h = window.innerHeight
  const ltr = Math.random() < 0.5
  const y0 = h * (0.08 + Math.random() * 0.34)
  const amp = 18 + Math.random() * 46
  const waves = 1 + Math.random() * 2
  const rise = (Math.random() - 0.5) * h * 0.25
  const phase = Math.random() * Math.PI * 2
  const n = 24
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1)
    const x = -80 + p * (w + 160)
    xs.push(ltr ? x : w - x)
    ys.push(y0 + Math.sin(p * Math.PI * 2 * waves + phase) * amp + rise * p)
  }
  return {
    id: nextId++,
    xs,
    ys,
    duration: 7 + Math.random() * 7,
    scale: 0.55 + Math.random() * 0.6,
    ltr,
    flap: 0.22 + Math.random() * 0.12,
  }
}

function Bat({ firstDelay }: { firstDelay: number }) {
  const [flight, setFlight] = useState<Flight | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const schedule = useCallback((ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFlight(makeFlight()), ms)
  }, [])

  useEffect(() => {
    schedule(firstDelay)
    return () => window.clearTimeout(timer.current)
  }, [firstDelay, schedule])

  if (!flight) return null
  return (
    <m.div
      key={flight.id}
      className="absolute left-0 top-0"
      initial={{ x: flight.xs[0], y: flight.ys[0] }}
      animate={{ x: flight.xs, y: flight.ys }}
      transition={{ duration: flight.duration, ease: 'linear' }}
      onAnimationComplete={() => {
        setFlight(null)
        schedule(3000 + Math.random() * 9000)
      }}
    >
      <svg
        width={44 * flight.scale}
        height={22 * flight.scale}
        viewBox="-22 -11 44 22"
        style={{ transform: flight.ltr ? undefined : 'scaleX(-1)' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="anim-flap" style={{ animationDuration: `${flight.flap}s` }}>
          <path
            d="M0 -2 C -4 -6, -10 -8, -21 -4 C -17 -2, -16 1, -17 4 C -13 1, -10 2, -9 5 C -7 2, -4 2, -2 4 Z M0 -2 C 4 -6, 10 -8, 21 -4 C 17 -2, 16 1, 17 4 C 13 1, 10 2, 9 5 C 7 2, 4 2, 2 4 Z"
            fill="#03040a"
            stroke="#8fa3c7"
            strokeOpacity="0.35"
            strokeWidth="0.6"
          />
        </g>
        <ellipse cx="0" cy="1" rx="2.6" ry="4" fill="#03040a" />
        <path d="M-2 -2 L-2.4 -5.5 L-0.6 -3 Z M2 -2 L2.4 -5.5 L0.6 -3 Z" fill="#03040a" />
      </svg>
    </m.div>
  )
}

const DELAYS = [600, 2400, 4200, 6900, 9800, 13000]

/** Six small bats crossing the sky on wavy paths at random intervals. */
export function Bats() {
  return (
    <LazyMotion features={domAnimation} strict>
      <div className="absolute inset-0">
        {DELAYS.map((d) => (
          <Bat key={d} firstDelay={d} />
        ))}
      </div>
    </LazyMotion>
  )
}
