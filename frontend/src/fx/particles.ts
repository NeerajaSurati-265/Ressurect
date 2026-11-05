/**
 * One full-screen canvas particle engine. Imperative: emit(preset, {x, y, count}).
 * Pooled, dt-based, capped at ~60 fps, sleeps when empty, paused while the tab is hidden,
 * and a no-op under prefers-reduced-motion. Coordinates are viewport CSS pixels.
 */
import { getQuality } from './quality'

export type ParticlePreset = 'ember' | 'spirit-mote' | 'dirt' | 'smoke' | 'firefly'

export interface EmitOptions {
  x: number
  y: number
  count?: number
  /** Spread radius around x/y in px (default per preset). */
  spread?: number
}

interface P {
  alive: boolean
  preset: ParticlePreset
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number
  size: number; seed: number
}

const MAX = 600
const pool: P[] = Array.from({ length: MAX }, () => ({
  alive: false, preset: 'ember', x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, seed: 0,
}))

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let last = 0
let liveCount = 0
let dpr = 1

const rand = (a: number, b: number) => a + Math.random() * (b - a)

function reduced() {
  return typeof window === 'undefined' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const DEFAULTS: Record<ParticlePreset, { count: number; spread: number }> = {
  ember: { count: 14, spread: 12 },
  'spirit-mote': { count: 40, spread: 40 },
  dirt: { count: 24, spread: 60 },
  smoke: { count: 10, spread: 30 },
  firefly: { count: 3, spread: 80 },
}

function init(p: P, preset: ParticlePreset, x: number, y: number) {
  p.alive = true
  p.preset = preset
  p.x = x; p.y = y
  p.seed = Math.random() * 1000
  switch (preset) {
    case 'ember':
      p.vx = rand(-45, 45); p.vy = rand(-90, -40); p.maxLife = rand(0.9, 1.8); p.size = rand(1, 2.4); break
    case 'spirit-mote':
      p.vx = rand(-12, 12); p.vy = rand(-70, -25); p.maxLife = rand(1.8, 3.4); p.size = rand(1.2, 2.8); break
    case 'dirt':
      p.vx = rand(-110, 110); p.vy = rand(-220, -60); p.maxLife = rand(0.7, 1.3); p.size = rand(1.2, 3.2); break
    case 'smoke':
      p.vx = rand(-14, 14); p.vy = rand(-30, -10); p.maxLife = rand(1.6, 3); p.size = rand(14, 30); break
    case 'firefly':
      p.vx = rand(-10, 10); p.vy = rand(-8, 8); p.maxLife = rand(4, 7); p.size = rand(1.4, 2.2); break
  }
  p.life = p.maxLife
}

export function emit(preset: ParticlePreset, opts: EmitOptions) {
  if (!ctx || reduced() || document.visibilityState === 'hidden') return
  const d = DEFAULTS[preset]
  // the runtime quality guard halves every burst on slow machines
  const n = Math.max(1, Math.round(Math.min(opts.count ?? d.count, 120) * (getQuality() === 'low' ? 0.5 : 1)))
  const spread = opts.spread ?? d.spread
  let made = 0
  for (let i = 0; i < MAX && made < n; i++) {
    const p = pool[i]
    if (p.alive) continue
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * spread
    init(p, preset, opts.x + Math.cos(a) * r, opts.y + Math.sin(a) * r * 0.5)
    made++
    liveCount++
  }
  wake()
}

/** Emit from the centre (or top-centre) of an element's bounding box. */
export function emitFrom(el: Element | null, preset: ParticlePreset, opts: Partial<EmitOptions> & { at?: 'center' | 'top' | 'bottom' } = {}) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const y = opts.at === 'top' ? r.top : opts.at === 'bottom' ? r.bottom : r.top + r.height / 2
  emit(preset, { x: r.left + r.width / 2, y, count: opts.count, spread: opts.spread ?? r.width / 3 })
}

function wake() {
  if (!raf && liveCount > 0) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

function tick(now: number) {
  raf = 0
  if (!ctx || !canvas) return
  const elapsed = now - last
  // Cap at ~60 fps; skip frames that come too fast (high-refresh screens).
  if (elapsed < 15) { raf = requestAnimationFrame(tick); return }
  const dt = Math.min(elapsed / 1000, 1 / 30)
  last = now
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  liveCount = 0
  for (let i = 0; i < MAX; i++) {
    const p = pool[i]
    if (!p.alive) continue
    p.life -= dt
    if (p.life <= 0) { p.alive = false; continue }
    liveCount++
    const t = 1 - p.life / p.maxLife // 0 -> 1
    const fade = Math.min(1, t * 6) * (1 - t)
    switch (p.preset) {
      case 'ember': {
        p.vx += Math.sin(now / 300 + p.seed) * 20 * dt
        p.vy *= 1 - 0.4 * dt
        p.x += p.vx * dt; p.y += p.vy * dt
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = `rgba(255,${150 + Math.round(60 * (1 - t))},60,${0.9 * fade})`
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'spirit-mote': {
        p.vx += Math.sin(now / 700 + p.seed) * 10 * dt
        p.x += p.vx * dt; p.y += p.vy * dt
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
        g.addColorStop(0, `rgba(200,250,240,${0.85 * fade})`)
        g.addColorStop(1, 'rgba(125,226,209,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'dirt': {
        p.vy += 520 * dt
        p.x += p.vx * dt; p.y += p.vy * dt
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = `rgba(42,34,30,${0.95 * (1 - t * t)})`
        ctx.fillRect(p.x, p.y, p.size, p.size * 0.8)
        break
      }
      case 'smoke': {
        p.x += p.vx * dt; p.y += p.vy * dt
        const s = p.size * (1 + t * 1.5)
        ctx.globalCompositeOperation = 'source-over'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s)
        g.addColorStop(0, `rgba(143,163,199,${0.18 * fade})`)
        g.addColorStop(1, 'rgba(143,163,199,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'firefly': {
        p.vx += Math.sin(now / 900 + p.seed) * 14 * dt
        p.vy += Math.cos(now / 1100 + p.seed * 2) * 14 * dt
        p.x += p.vx * dt; p.y += p.vy * dt
        const pulse = 0.5 + 0.5 * Math.sin(now / 600 + p.seed)
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5)
        g.addColorStop(0, `rgba(255,214,140,${0.8 * fade * pulse})`)
        g.addColorStop(1, 'rgba(255,138,31,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2); ctx.fill()
        break
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  if (liveCount > 0 && document.visibilityState !== 'hidden') raf = requestAnimationFrame(tick)
}

function resize() {
  if (!canvas) return
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  } else wake()
}

/** Called by <ParticleLayer/>. Returns a cleanup. */
export function attachCanvas(el: HTMLCanvasElement): () => void {
  canvas = el
  ctx = el.getContext('2d')
  resize()
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', onVisibility)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    canvas = null
    ctx = null
    for (const p of pool) p.alive = false
    liveCount = 0
  }
}
