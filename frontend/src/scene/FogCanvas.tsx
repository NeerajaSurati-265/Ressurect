import { useEffect, useRef, useState } from 'react'
import { getQuality, onQuality } from '../fx/quality'
import { createFogRenderer, fogScale, FOG_FPS, MAX_EMBERS, type Ember } from './fog'
import { setWebglFogActive } from './fogState'
import { useReducedMotion } from './hooks'

/** Wait this long after load (then for idle) before compiling the fog shader. */
const START_DELAY_MS = 1500
/** Resolution steps (x the FOG_SCALE for the viewport). */
const LEVELS = [1, 0.7, 0.5]
/** Average JS-side draw cost (ms) above which the fog steps down. */
const MAX_DRAW_MS = 4

/** Positions of the light sources, sampled from the DOM at low frequency (no per-frame layout reads). */
function sampleSources() {
  const moonEl = document.querySelector('[data-moon-disc]')
  const mr = moonEl?.getBoundingClientRect()
  const moon = mr && mr.width > 0 ? { x: mr.left + mr.width / 2, y: mr.top + mr.height / 2 } : { x: 160, y: 110 }
  const embers: Ember[] = []
  document.querySelectorAll('[data-fog-ember]').forEach((el) => {
    if (embers.length >= MAX_EMBERS - 1) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return
    embers.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, i: Number(el.getAttribute('data-fog-ember')) || 0.6 })
  })
  return { moon, embers }
}

/** The Keeper writes --keeper-lx/ly/light inline on <html> while its lantern moves. */
function keeperLight(): Ember | null {
  const s = document.documentElement.style
  const light = parseFloat(s.getPropertyValue('--keeper-light'))
  if (!(light > 0)) return null
  const x = parseFloat(s.getPropertyValue('--keeper-lx'))
  const y = parseFloat(s.getPropertyValue('--keeper-ly'))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y, i: 0.8 * Math.min(1, light) }
}

/**
 * One full-screen WebGL fog canvas between the scene (z-0) and the content (z-10).
 * Falls back to the CSS GroundFog (rendered by Scene) when WebGL is unavailable, under reduced
 * motion, after a lost context, or once the quality guard reports 'low'. The two are never both drawn:
 * the shared flag in fogState is only true while this canvas is rendering.
 */
export function FogCanvas() {
  const reduced = useReducedMotion()
  const [low, setLow] = useState(() => getQuality() === 'low')
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Start only after the page has loaded and gone idle: the CSS fog covers the first seconds, and
  // shader compilation never competes with the first paint or the first interaction.
  const [ready, setReady] = useState(false)
  const enabled = ready && !reduced && !low && !failed

  useEffect(() => onQuality((q) => setLow(q === 'low')), [])

  useEffect(() => {
    if (reduced || low) return
    let t = 0
    let idle = 0
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200))
    const cic = window.cancelIdleCallback ?? window.clearTimeout
    const go = () => {
      t = window.setTimeout(() => {
        idle = ric(() => setReady(true), { timeout: 3000 }) as number
      }, START_DELAY_MS)
    }
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
    return () => {
      window.removeEventListener('load', go)
      window.clearTimeout(t)
      cic(idle)
    }
  }, [reduced, low])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!enabled || !canvas) return
    const fog = createFogRenderer(canvas)
    if (!fog) {
      queueMicrotask(() => setFailed(true))
      return
    }
    let raf = 0
    let last = -Infinity
    let lastSample = -Infinity
    let lastKeeper = -Infinity
    let sources = sampleSources()
    let keeper: Ember | null = null
    const t0 = performance.now() - 40000 // start mid-drift so the first frame is already swirling
    const interval = 1000 / FOG_FPS

    // Adaptive resolution: the fog times its own draw (on a slow or software GPU the cost shows up
    // here as command-buffer back-pressure). Too slow -> step the resolution down; still too slow at
    // the lowest step -> hand over to the CSS fog for good.
    let level = 0
    let costAvg = 0
    let costN = 0
    let gaveUp = false
    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      fog.resize(w, h, Math.min(window.devicePixelRatio || 1, 2) * fogScale(w) * LEVELS[level])
      sources = sampleSources()
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < interval - 1) return
      last = now
      if (now - lastSample > 700) {
        lastSample = now
        sources = sampleSources()
      }
      if (now - lastKeeper > 200) {
        lastKeeper = now
        keeper = keeperLight()
      }
      const ts = (now - t0) / 1000
      // a gentle flicker so the warm pools breathe with the pumpkin flames
      const embers = sources.embers.map((e, n) => ({
        ...e,
        i: e.i * (0.82 + 0.12 * Math.sin(ts * (5.1 + n * 1.7) + n) + 0.06 * Math.sin(ts * 13.3 + n * 3.1)),
      }))
      if (keeper) embers.push(keeper)
      const c0 = performance.now()
      fog.draw(ts, sources.moon, embers)
      const cost = performance.now() - c0
      costAvg = costN === 0 ? cost : costAvg * 0.85 + cost * 0.15
      if (++costN >= 20 && costAvg > MAX_DRAW_MS && !gaveUp) {
        costN = 0
        if (level < LEVELS.length - 1) {
          level++
          resize()
        } else {
          gaveUp = true
          console.info('[resurrect] fog too slow on this device, using the light fog')
          stop()
          setWebglFogActive(false)
          setFailed(true)
        }
      }
    }

    const start = () => {
      if (!raf && document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const onVis = () => (document.visibilityState === 'hidden' ? stop() : start())
    const onLost = (e: Event) => {
      e.preventDefault()
      stop()
      setWebglFogActive(false)
      setFailed(true)
    }

    resize()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    canvas.addEventListener('webglcontextlost', onLost)
    start()
    setWebglFogActive(true)
    const fadeIn = requestAnimationFrame(() => setShown(true))

    // the quality guard went low: tear WebGL down for good (the CSS fog takes over)
    const offQuality = onQuality((q) => {
      if (q !== 'low') return
      stop()
      canvas.removeEventListener('webglcontextlost', onLost)
      fog.dispose(true)
      setWebglFogActive(false)
    })

    return () => {
      stop()
      cancelAnimationFrame(fadeIn)
      offQuality()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost)
      fog.dispose(false)
      setWebglFogActive(false)
      setShown(false)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
      style={{ opacity: shown ? 1 : 0, transition: 'opacity 1.4s ease' }}
    />
  )
}
