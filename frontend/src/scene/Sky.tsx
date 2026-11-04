import { useCallback, useEffect, useRef } from 'react'
import { mulberry32, useFrameLoop } from './hooks'

type Star = { x: number; y: number; r: number; base: number; amp: number; speed: number; phase: number; tint: string }

const TINTS = ['233,236,245', '233,236,245', '233,236,245', '200,214,240', '255,214,170']

function makeStars(count: number, w: number, h: number): Star[] {
  const rand = mulberry32(1031)
  return Array.from({ length: count }, () => {
    const big = rand() < 0.08
    return {
      x: rand() * w,
      // denser near the top of the sky, thinning toward the hills
      y: Math.pow(rand(), 1.5) * h * 0.78,
      r: big ? 1.1 + rand() * 0.7 : 0.4 + rand() * 0.7,
      base: 0.35 + rand() * 0.45,
      amp: 0.15 + rand() * 0.3,
      speed: 0.0006 + rand() * 0.0018,
      phase: rand() * Math.PI * 2,
      tint: TINTS[Math.floor(rand() * TINTS.length)],
    }
  })
}

/** Night gradient plus a canvas starfield (at most 150 stars) that twinkles at 30 fps. */
export function Sky({ reduced, mobile }: { reduced: boolean; mobile: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const count = mobile ? 70 : 150

  const draw = useCallback((now: number) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = canvas.width / Math.max(1, canvas.clientWidth)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    for (const s of starsRef.current) {
      const a = Math.max(0, Math.min(1, s.base + s.amp * Math.sin(now * s.speed + s.phase)))
      ctx.fillStyle = `rgba(${s.tint},${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      starsRef.current = makeStars(count, w, h)
      draw(performance.now())
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [count, draw])

  useFrameLoop(draw, 30, !reduced)

  return (
    <div
      className="absolute inset-0"
      style={{
        // cold haze thickens toward the horizon; moonlight lifts the upper left
        background:
          'radial-gradient(ellipse 70% 55% at 12% 8%, rgba(143,163,199,0.10), transparent 70%), radial-gradient(ellipse 120% 40% at 50% 78%, rgba(60,74,128,0.35), transparent 70%), linear-gradient(to bottom, var(--night-950) 0%, #0a0c1a 40%, #1a2042 100%)',
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
