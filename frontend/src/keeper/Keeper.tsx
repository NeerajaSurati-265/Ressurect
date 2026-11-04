import { useEffect, useRef, useState, type RefObject } from 'react'
import { emit } from '../fx/particles'
import { intro } from '../scene/intro'
import { keeperSignal } from './keeperSignal'
import {
  collectObstacles,
  collides,
  fits,
  RATIO,
  rectOf,
  reserved,
  solve,
  solveAnywhere,
  VB,
  WHISPER_H,
  WHISPER_W,
  type Placement,
  type Rect,
  type SolveOpts,
} from './placement'
import { getKeeper, subscribeKeeper, subscribeKeeperEvents, type KeeperDirective, type KeeperMood } from './store'

/**
 * The Keeper: an original hooded lantern-bearer who travels the page beside the ritual.
 * Mounted once in the Layout, in its own fixed layer above the scene and the page content,
 * below the fog wipe, particles and grain. Everything moves through one rAF loop that writes
 * transforms straight to the DOM; React renders the art once.
 *
 * Screens drive it only through the store (setKeeper / useKeeperScript / keeperEvent) and
 * data-keeper-anchor / data-keeper-focus attributes. Hidden on phones (DESIGN.md).
 */

/** Rendered base size; the figure is scaled from here. */
const BASE_H = 300
const BASE_W = BASE_H * RATIO
const K = BASE_H / VB.h // px per SVG unit at scale 1

const SHOULDER = { x: 150, y: 200 }
const PIVOT = { x: 60, y: 232 }
const LANTERN_C = { x: -4, y: 47 } // from the pivot, at rest
const FEET = { x: 150, y: 548 }
const NECK = { x: 150, y: 178 }
const ROBE_TOP = { x: 150, y: 150 }

interface Pose {
  /** lantern arm: -1 lowered, 0 held out, 1 raised high */
  lift: number
  /** degrees; negative leans toward the lantern side (the anchor) */
  lean: number
  /** degrees the hood bows forward */
  bow: number
  /** lantern brightness multiplier */
  glow: number
  /** ember-eye intensity 0..1 */
  eyes: number
  /** extra distance from the anchor in px (stepping back) */
  gap: number
  /** aim the sleeve at: the anchor, the focus element, or nothing */
  aim: 'anchor' | 'focus' | null
}

const POSE: Record<KeeperMood, Pose> = {
  idle: { lift: 0, lean: -1, bow: 1, glow: 1, eyes: 0.42, gap: 0, aim: 'anchor' },
  rising: { lift: 1.05, lean: 3, bow: -5, glow: 1.4, eyes: 0.7, gap: 28, aim: null },
  seance: { lift: 0.25, lean: -3, bow: 3, glow: 1, eyes: 0.55, gap: 24, aim: null },
  listening: { lift: -0.85, lean: -9, bow: 10, glow: 0.85, eyes: 0.62, gap: 18, aim: null },
  triumph: { lift: 1.2, lean: 5, bow: -7, glow: 1.65, eyes: 0.95, gap: 72, aim: null },
  presenting: { lift: 0.1, lean: -4, bow: 2, glow: 1.15, eyes: 0.6, gap: 24, aim: 'focus' },
  recoil: { lift: 0.45, lean: 11, bow: -4, glow: 0.7, eyes: 1, gap: 96, aim: null },
  vigil: { lift: -0.2, lean: -2, bow: 5, glow: 0.78, eyes: 0.5, gap: 28, aim: null },
  mourning: { lift: -0.7, lean: -2, bow: 13, glow: 0.5, eyes: 0.24, gap: 28, aim: null },
  barred: { lift: -0.4, lean: 5, bow: 7, glow: 0.62, eyes: 0.34, gap: 48, aim: null },
  guiding: { lift: 0.55, lean: -4, bow: 0, glow: 1.2, eyes: 0.55, gap: 24, aim: 'focus' },
}

const IDLE_WANDER_MS = 25000

type V = { x: number; y: number }
const rot = (p: V, deg: number): V => {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** frame-rate independent exponential approach */
const approach = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt))

/** Heavy spring step response over normalised time: ~4% overshoot, settled at s = 1. */
function springEase(s: number) {
  if (s <= 0) return 0
  const z = 0.72
  const w = 4.6 / z
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * s) * (Math.cos(wd * s) + ((z * w) / wd) * Math.sin(wd * s))
}

interface Flight {
  from: { x: number; y: number; h: number }
  bulge: V
  t0: number
  dur: number
}

interface Wander {
  phase: 'out' | 'linger' | 'back'
  far: { x: number; y: number; h: number }
  until: number
}

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

export function KeeperLayer() {
  const wide = useMedia('(min-width: 640px)')
  if (!wide) return null
  return <KeeperCompanion />
}

function KeeperCompanion() {
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const wrap = useRef<HTMLDivElement>(null)
  const whisperEl = useRef<HTMLDivElement>(null)
  const ambient = useRef<HTMLDivElement>(null)
  const pool = useRef<HTMLDivElement>(null)
  const g = {
    body: useRef<SVGGElement>(null),
    robe: useRef<SVGGElement>(null),
    hood: useRef<SVGGElement>(null),
    arm: useRef<SVGGElement>(null),
    lantern: useRef<SVGGElement>(null),
    glow: useRef<SVGGElement>(null),
    flame: useRef<SVGGElement>(null),
    eyes: useRef<SVGGElement>(null),
    wash: useRef<SVGGElement>(null),
  }
  const [whisper, setWhisper] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const hoverRef = useRef(false)
  hoverRef.current = hover

  useEffect(() => {
    const root = document.documentElement
    let dir: KeeperDirective = getKeeper()
    let raf = 0
    let last = performance.now()
    const t0 = last

    // ---- placement state ----
    let target: Placement | null = null
    /** target relative to its anchor, so scrolling carries it along */
    let rel: { dx: number; dy: number } | null = null
    let anchorRect: Rect | null = null
    let obstacles: Rect[] = []
    let dirty = true
    let force = true
    let lastMeasure = 0
    let missingSince = 0

    // ---- motion state ----
    const pos = { x: 0, y: 0, h: 260 }
    let placed = false
    const vel = { x: 0, y: 0 }
    const acc = { x: 0, y: 0 }
    let flight: Flight | null = null
    let wander: Wander | null = null
    let facing = 1
    let theta = 0
    let omega = 0
    let nextSway = last + 3000 + Math.random() * 5000
    let lastSmoke = 0
    let opacity = 0
    let hiddenWanted = true
    let lastVisible = false
    let introDone = !intro.playing()
    let lastActivity = last
    let lastVars = 0
    let lastVarPos = { x: -1, y: -1, l: -1 }

    const pose = { ...POSE[dir.mood], arm: 0 }
    let wake = 0
    let flare = 0
    let beat = 0
    let focusVec: V | null = null

    const offIntro = intro.subscribe(() => {
      introDone = true
    })

    const vw = () => window.innerWidth
    const vh = () => window.innerHeight

    const sizes = (mood: KeeperMood) => {
      const h = vh()
      if (mood === 'idle') return { size: clamp(h * 0.58, 240, 520), min: 170, ground: true }
      return { size: clamp(h * 0.32, 190, 290), min: 140, ground: false }
    }

    const solveFor = (a: Rect, prev?: Placement | null): Placement | null => {
      const s = sizes(dir.mood)
      const o: SolveOpts = {
        vw: vw(),
        vh: vh(),
        anchor: a,
        obstacles,
        size: s.size,
        minSize: s.min,
        gap: 24 + POSE[dir.mood].gap,
        ground: s.ground,
        whisper: !!dir.whisper,
        prevSide: prev?.side,
      }
      return solve(o) ?? solveAnywhere({ ...o, ground: false, size: Math.min(o.size, 260), minSize: 130 })
    }

    const stillFits = (p: Placement) =>
      fits(p, { vw: vw(), vh: vh(), anchor: anchorRect!, obstacles, size: 0, minSize: 0, gap: 0, ground: false, whisper: !!dir.whisper })

    /** Choose the arc's bulge: up-and-over, outward, or flat, whichever crosses the least content. */
    const pickBulge = (from: V & { h: number }, to: Placement): V => {
      const dx = to.x - from.x
      const dy = to.y - from.y
      const dist = Math.hypot(dx, dy)
      const mag = clamp(dist * 0.24, 26, 170)
      const n1 = { x: -dy / (dist || 1), y: dx / (dist || 1) }
      const n2 = { x: -n1.x, y: -n1.y }
      const options = [n1, n2].map((n) => ({ x: n.x * mag, y: n.y * mag }))
      options.push({ x: 0, y: -mag * 0.3 })
      let best = options[0]
      let bestScore = Infinity
      for (const b of options) {
        let hits = 0
        for (let i = 1; i < 12; i++) {
          const u = i / 12
          const p = bez(from, b, to, u)
          const h = lerp(from.h, to.h, u)
          if (collides(reserved(p.x, p.y, h, false), obstacles)) hits++
          if (p.y < -h * 0.3 || p.y > vh()) hits += 0.5
        }
        // prefer arcs that lift (drifting up and over) when they tie
        const score = hits + (b.y > 0 ? 0.25 : 0)
        if (score < bestScore) {
          bestScore = score
          best = b
        }
      }
      return best
    }

    const bez = (from: V, bulge: V, to: V, u: number): V => {
      const c = { x: (from.x + to.x) / 2 + bulge.x, y: (from.y + to.y) / 2 + bulge.y }
      const a = 1 - u
      return { x: a * a * from.x + 2 * a * u * c.x + u * u * to.x, y: a * a * from.y + 2 * a * u * c.y + u * u * to.y }
    }

    const startFlight = (to: Placement, now: number, dur?: number) => {
      const from = { x: pos.x, y: pos.y, h: pos.h }
      const dist = Math.hypot(to.x - from.x, to.y - from.y)
      if (dist < 6 && Math.abs(to.h - from.h) < 4) return
      flight = {
        from,
        bulge: pickBulge(from, to),
        t0: now,
        dur: dur ?? 1200 + 600 * Math.min(1, dist / 900),
      }
    }

    const measure = (now: number) => {
      lastMeasure = now
      dirty = false
      const W = vw()
      const H = vh()
      obstacles = collectObstacles(W, H)
      const el = dir.anchor ? document.querySelector(`[data-keeper-anchor="${dir.anchor}"]`) : null
      if (!el) {
        anchorRect = null
        if (!missingSince) missingSince = now
        // the screen has not painted its anchor yet: hold position; give up after a moment
        if (now - missingSince > 1600 || !placed) hiddenWanted = !placed || !target || !stillFitsLoose()
        force = force || !placed
        return
      }
      missingSince = 0
      const a = rectOf(el)
      anchorRect = a

      // keep the current spot (carried by the anchor) while it stays clear
      if (!force && target && rel) {
        const carried: Placement = {
          ...target,
          x: a.x + rel.dx,
          y: clamp(a.y + rel.dy, 22, H - 22 - target.h - (dir.whisper ? WHISPER_H : 0)),
        }
        if (stillFits(carried)) {
          target = carried
          hiddenWanted = false
          return
        }
      }
      const next = solveFor(a, target)
      const wasForced = force
      force = false
      if (!next) {
        hiddenWanted = true
        return
      }
      hiddenWanted = false
      const prev = target
      target = next
      rel = { dx: next.x - a.x, dy: next.y - a.y }
      if (!placed) {
        pos.x = next.x
        pos.y = next.y
        pos.h = next.h
        placed = true
        facing = next.side === 'right' ? 1 : -1
        return
      }
      if (reduced) return // snapped behind a fade in step()
      const jump = prev ? Math.hypot(next.x - prev.x, next.y - prev.y) : Infinity
      if (wasForced || jump > 60 || Math.abs(next.h - (prev?.h ?? next.h)) > 30) {
        if (!wander) startFlight(next, now, dir.mood === 'recoil' ? 720 : undefined)
      }
    }

    const stillFitsLoose = () => {
      if (!target) return false
      const r = reserved(target.x, target.y, target.h, !!dir.whisper)
      return !collides(r, obstacles)
    }

    // ---- directive changes ----
    let whisperTimer = 0
    const onDirective = (d: KeeperDirective) => {
      const prevMood = dir.mood
      dir = d
      force = true
      dirty = true
      missingSince = 0
      if (wander) wander = null
      const now = performance.now()
      lastActivity = now
      window.clearTimeout(whisperTimer)
      setWhisper(null)
      if (d.whisper) {
        const text = d.whisper
        whisperTimer = window.setTimeout(() => {
          setWhisper(text)
          whisperTimer = window.setTimeout(() => setWhisper(null), 6500)
        }, 1500)
      }
      if (reduced) return
      if (d.mood === 'recoil' && prevMood !== 'recoil') {
        omega += (Math.random() < 0.5 ? -1 : 1) * 170
        flare = 1
      }
      if (d.mood === 'triumph') {
        window.setTimeout(() => {
          const l = lanternScreen()
          if (l) emit('ember', { x: l.x, y: l.y, count: 26, spread: 16 })
        }, 900)
      }
      if (d.mood === 'rising') {
        window.setTimeout(() => {
          const l = lanternScreen()
          if (l) emit('ember', { x: l.x, y: l.y, count: 14, spread: 10 })
        }, 1300)
      }
    }
    const offDir = subscribeKeeper(onDirective)
    const offEv = subscribeKeeperEvents((e) => {
      if (e === 'line') flare = Math.max(flare, 0.75)
      else beat = 1
    })
    const offSig = keeperSignal.subscribe(({ focus, flare: f }) => {
      wake = focus ? 1 : 0
      if (f) flare = Math.max(flare, 0.9)
      activity()
    })

    // ---- activity (for the idle wander) ----
    const activity = () => {
      lastActivity = performance.now()
      if (wander && wander.phase !== 'back') {
        wander = null
        force = true
        dirty = true
      }
    }
    let lastMove = 0
    const onMove = () => {
      const n = performance.now()
      if (n - lastMove > 400) {
        lastMove = n
        activity()
      }
    }
    const onScroll = () => {
      dirty = true
      activity()
    }
    const onResize = () => {
      dirty = true
      force = true
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', activity, { passive: true })
    window.addEventListener('keydown', activity)

    const tryWander = (now: number) => {
      if (!target || !anchorRect) return
      const H = vh()
      const farH = clamp(target.h * 0.42, 110, 190)
      const far = {
        x: clamp(vw() * 0.07, 24, vw() * 0.3),
        y: target.y + target.h - farH - H * 0.05,
        h: farH,
      }
      // the whole path must stay clear of content, or it does not go
      for (let i = 0; i <= 16; i++) {
        const u = i / 16
        const x = lerp(target.x, far.x, u)
        const y = lerp(target.y, far.y, u) - Math.sin(u * Math.PI) * 18
        const h = lerp(target.h, far.h, Math.min(1, u * 2.2))
        if (collides(reserved(x, y, h, false), obstacles) || y + h > H) {
          lastActivity = now
          return
        }
      }
      wander = { phase: 'out', far, until: now + 7600 }
      flight = { from: { ...pos }, bulge: { x: 0, y: -18 }, t0: now, dur: 7600 }
    }

    // ---- geometry helpers ----
    const scale = () => pos.h / BASE_H
    const wrapOrigin = () => {
      const s = scale()
      const w = BASE_W * s
      return { tx: pos.x + (w * (1 - facing)) / 2, ty: pos.y, s }
    }
    const toScreen = (p: V, floatY: number) => {
      const { tx, ty, s } = wrapOrigin()
      return { x: tx + facing * s * K * (p.x - VB.x), y: ty + s * K * (p.y + floatY - VB.y) }
    }
    let floatY = 0
    const lanternLocal = (): V => {
      const piv = rot({ x: PIVOT.x - SHOULDER.x, y: PIVOT.y - SHOULDER.y }, pose.arm)
      const p = { x: SHOULDER.x + piv.x, y: SHOULDER.y + piv.y }
      const c = rot(LANTERN_C, theta)
      const l = { x: p.x + c.x, y: p.y + c.y }
      const r = rot({ x: l.x - FEET.x, y: l.y - FEET.y }, pose.lean)
      return { x: FEET.x + r.x, y: FEET.y + r.y }
    }
    const lanternScreen = () => (placed ? toScreen(lanternLocal(), floatY) : null)

    // ---- the frame ----
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = Math.min(0.05, (now - last) / 1000)
      if (dt < 0.012) return
      last = now
      const t = (now - t0) / 1000

      if (dirty || now - lastMeasure > 300) measure(now)

      const H = vh()

      // ---- idle wander across the back of the graveyard ----
      if (!reduced && dir.mood === 'idle' && !flight && !wander && placed && !hiddenWanted && now - lastActivity > IDLE_WANDER_MS) {
        tryWander(now)
      }
      if (wander && !flight) {
        if (wander.phase === 'out') {
          wander.phase = 'linger'
          wander.until = now + 2400
        } else if (wander.phase === 'linger' && now > wander.until) {
          wander.phase = 'back'
          if (target) flight = { from: { ...pos }, bulge: { x: 0, y: -14 }, t0: now, dur: 6600 }
        } else if (wander.phase === 'back') {
          wander = null
          lastActivity = now
        }
      }

      // ---- position ----
      const prevX = pos.x
      const prevY = pos.y
      const dest = wander && wander.phase !== 'back' ? { ...wander.far, side: 'left' as const } : target
      if (dest && placed) {
        if (reduced) {
          // no travel: fade out, jump, fade in
          const far = Math.hypot(dest.x - pos.x, dest.y - pos.y) > 2 || Math.abs(dest.h - pos.h) > 2
          if (far && opacity < 0.04) {
            pos.x = dest.x
            pos.y = dest.y
            pos.h = dest.h
            facing = dest.side === 'right' ? 1 : -1
          }
        } else if (flight) {
          const s = (now - flight.t0) / flight.dur
          const u = springEase(s)
          const p = bez(flight.from, flight.bulge, dest, u)
          pos.x = p.x
          pos.y = p.y
          pos.h = lerp(flight.from.h, dest.h, clamp(u, 0, 1))
          if (s >= 1) flight = null
        } else {
          pos.x = approach(pos.x, dest.x, 8, dt)
          pos.y = approach(pos.y, dest.y, 8, dt)
          pos.h = approach(pos.h, dest.h, 5, dt)
        }
      }
      const nvx = (pos.x - prevX) / dt
      const nvy = (pos.y - prevY) / dt
      const pvx = vel.x
      vel.x = approach(vel.x, nvx, 18, dt)
      vel.y = approach(vel.y, nvy, 18, dt)
      acc.x = approach(acc.x, (vel.x - pvx) / dt, 14, dt)
      const speed = Math.hypot(vel.x, vel.y)

      // ---- facing: lantern leads while travelling, faces the anchor at rest ----
      let faceTo = facing
      if (flight && Math.abs(vel.x) > 140) faceTo = vel.x < 0 ? 1 : -1
      else if (!flight && dest) faceTo = dest.side === 'right' ? 1 : -1
      if (!reduced) facing = approach(facing, faceTo, 3.2, dt)
      else facing = faceTo
      if (Math.abs(facing) < 0.05) facing = facing < 0 ? -0.05 : 0.05
      const sign = facing >= 0 ? 1 : -1
      const lvx = vel.x * sign
      const lax = acc.x * sign

      // ---- pose ----
      const base = POSE[wander ? 'idle' : dir.mood]
      const hoverK = hoverRef.current ? 1 : 0
      let armTarget = base.lift * 34
      focusVec = null
      if (base.aim && placed) {
        const el =
          base.aim === 'anchor'
            ? dir.anchor && document.querySelector(`[data-keeper-anchor="${dir.anchor}"]`)
            : dir.focus && document.querySelector(`[data-keeper-focus="${dir.focus}"]`)
        if (el) {
          const r = el.getBoundingClientRect()
          const sh = toScreen(SHOULDER, floatY)
          focusVec = { x: (r.left + r.width / 2 - sh.x) * sign, y: r.top + r.height / 2 - sh.y }
          const want = (Math.atan2(focusVec.y, focusVec.x) * 180) / Math.PI
          const rest = (Math.atan2(22, -88) * 180) / Math.PI
          let d = want - rest
          while (d > 180) d -= 360
          while (d < -180) d += 360
          armTarget = clamp(d, -30, 34) + base.lift * 12
        }
      }
      if (wander) armTarget = wander.phase === 'linger' ? 18 : 6
      const rate = reduced ? 1000 : 2.6
      pose.arm = approach(pose.arm, armTarget, rate, dt)
      pose.lean = approach(pose.lean, base.lean + clamp(lvx * 0.006, -7, 7) + hoverK * 3, rate, dt)
      pose.bow = approach(pose.bow, base.bow - hoverK * 3, rate, dt)
      pose.glow = approach(pose.glow, (wander ? 0.75 : base.glow) + wake * 0.25, 3, dt)
      pose.eyes = approach(pose.eyes, Math.min(1, base.eyes + wake * 0.4 + hoverK * 0.35), 4, dt)
      flare *= Math.exp(-dt * 4.5)
      beat *= Math.exp(-dt * 7)

      // ---- lantern pendulum: hangs from the sleeve, driven by horizontal motion ----
      if (reduced) {
        theta = 0
        omega = 0
      } else {
        const w0 = (2 * Math.PI) / 1.75
        const bias = clamp(lvx * 0.012, -14, 14) + (focusVec ? clamp(-focusVec.x * 0.01, -8, 8) : 0)
        const alpha = -w0 * w0 * (theta - bias) - 2 * 0.09 * w0 * omega + clamp(lax, -4000, 4000) * 0.13
        omega += alpha * dt
        theta = clamp(theta + omega * dt, -38, 38)
        // the idle sway is irregular: random nudges at random intervals
        if (now > nextSway) {
          omega += (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 14)
          nextSway = now + 3800 + Math.random() * 7800
        }
      }

      // ---- breathing float (three incommensurate sines, never repeats) ----
      floatY = reduced
        ? 0
        : 3.6 * Math.sin(t * 0.83) + 1.7 * Math.sin(t * 0.31 + 1.7) + 0.9 * Math.sin(t * 1.93 + 0.4)
      const breathe = reduced ? 1 : 1 + 0.009 * Math.sin(t * 0.83 + 0.9)
      const drift = reduced ? 0 : 0.6 * Math.sin(t * 0.23 + 2)

      // ---- robe trails the motion ----
      const skew = reduced ? 0 : clamp(-lvx * 0.018, -13, 13)
      const stretch = reduced ? 0 : Math.min(0.07, speed * 0.00006)

      // ---- visibility: dissolve when no clear spot, or while crossing over content ----
      let visWanted = !hiddenWanted && placed && introDone && !!target
      if (visWanted && flight && collides(reserved(pos.x, pos.y, pos.h, false), obstacles)) visWanted = false
      if (reduced && dest && (Math.abs(dest.x - pos.x) > 2 || Math.abs(dest.y - pos.y) > 2)) visWanted = false
      const visTarget = visWanted ? (wander ? 0.6 : 1) : 0
      opacity = approach(opacity, visTarget, reduced ? 9 : visTarget > opacity ? 3.2 : 5, dt)
      const visibleNow = opacity > 0.5
      if (!reduced && visibleNow !== lastVisible && placed) {
        const s = scale()
        emit('smoke', { x: pos.x + (BASE_W * s) / 2, y: pos.y + pos.h * 0.6, count: 7, spread: BASE_W * s * 0.4 })
      }
      lastVisible = visibleNow

      // ---- smoke from the hem while moving ----
      if (!reduced && opacity > 0.05 && speed > 70 && now - lastSmoke > 50 + Math.random() * 40) {
        lastSmoke = now
        const s = scale()
        const w = BASE_W * s
        emit('smoke', {
          x: pos.x + w / 2 - Math.sign(vel.x) * w * 0.15,
          y: pos.y + pos.h * 0.93,
          count: speed > 400 ? 2 : 1,
          spread: w * 0.28,
        })
      }

      // ---- write to the DOM ----
      const { tx, ty, s } = wrapOrigin()
      const hoverShift = hoverK * 14 * (target?.side === 'left' ? -1 : 1)
      if (wrap.current) {
        wrap.current.style.transform = `translate3d(${(tx + hoverShift).toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${(facing * s).toFixed(4)}, ${s.toFixed(4)})`
        wrap.current.style.opacity = opacity.toFixed(3)
      }
      const sa = (el: SVGGElement | null, v: string) => el?.setAttribute('transform', v)
      sa(g.body.current, `translate(0 ${floatY.toFixed(2)}) rotate(${(pose.lean + drift).toFixed(2)} ${FEET.x} ${FEET.y})`)
      sa(
        g.robe.current,
        `translate(${ROBE_TOP.x} ${ROBE_TOP.y}) skewX(${skew.toFixed(2)}) scale(${(1 - stretch * 0.4).toFixed(4)} ${(breathe + stretch).toFixed(4)}) translate(${-ROBE_TOP.x} ${-ROBE_TOP.y})`,
      )
      sa(g.hood.current, `rotate(${(-pose.bow + skew * 0.15).toFixed(2)} ${NECK.x} ${NECK.y})`)
      sa(g.arm.current, `rotate(${pose.arm.toFixed(2)} ${SHOULDER.x} ${SHOULDER.y})`)
      sa(g.lantern.current, `rotate(${(theta - pose.arm).toFixed(2)} ${PIVOT.x} ${PIVOT.y})`)
      const flameScale = 1 + beat * 0.38 + flare * 0.16
      sa(g.flame.current, `translate(56 293) scale(${(1 + beat * 0.12).toFixed(3)} ${flameScale.toFixed(3)}) translate(-56 -293)`)
      const glowV = clamp(0.35 + 0.55 * pose.glow + flare * 0.45 + beat * 0.5, 0, 1.6)
      if (g.glow.current) g.glow.current.style.opacity = Math.min(1, glowV).toFixed(3)
      if (g.wash.current) g.wash.current.style.opacity = clamp(0.5 + 0.5 * pose.glow + flare * 0.3, 0, 1).toFixed(3)
      if (g.eyes.current) g.eyes.current.style.opacity = clamp(0.3 + 0.7 * pose.eyes + flare * 0.25, 0, 1).toFixed(3)

      // ---- light follows the lantern: ambient, ground pool, glass panels ----
      const L = toScreen(lanternLocal(), floatY)
      const light = opacity * clamp(pose.glow + flare * 0.4 + beat * 0.35, 0, 1.8)
      if (ambient.current) {
        const R = 520 * clamp(s, 0.6, 1.4)
        ambient.current.style.transform = `translate3d(${(L.x - R).toFixed(1)}px, ${(L.y - R).toFixed(1)}px, 0)`
        ambient.current.style.width = ambient.current.style.height = `${(R * 2).toFixed(0)}px`
        ambient.current.style.opacity = (0.75 * light).toFixed(3)
      }
      if (pool.current) {
        const groundY = H - Math.max(26, H * 0.05)
        const near = clamp(1 - (groundY - L.y) / (H * 0.75), 0, 1)
        pool.current.style.transform = `translate3d(${(L.x - 300).toFixed(1)}px, ${(groundY - 45).toFixed(1)}px, 0)`
        pool.current.style.opacity = (light * near * near * 0.9).toFixed(3)
      }
      if (now - lastVars > 48) {
        const moved = Math.abs(L.x - lastVarPos.x) + Math.abs(L.y - lastVarPos.y) > 2 || Math.abs(light - lastVarPos.l) > 0.03
        if (moved) {
          lastVars = now
          lastVarPos = { x: L.x, y: L.y, l: light }
          root.style.setProperty('--keeper-lx', `${L.x.toFixed(0)}px`)
          root.style.setProperty('--keeper-ly', `${L.y.toFixed(0)}px`)
          root.style.setProperty('--keeper-light', light.toFixed(2))
        }
      }
      if (whisperEl.current) {
        const w = BASE_W * s
        whisperEl.current.style.transform = `translate3d(${(pos.x + w / 2 - WHISPER_W / 2).toFixed(1)}px, ${(pos.y + pos.h + 2 + floatY * s * K * 0.6).toFixed(1)}px, 0)`
        whisperEl.current.style.opacity = opacity.toFixed(3)
      }
    }
    raf = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(whisperTimer)
      offIntro()
      offDir()
      offEv()
      offSig()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      root.style.removeProperty('--keeper-lx')
      root.style.removeProperty('--keeper-ly')
      root.style.removeProperty('--keeper-light')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  return (
    <>
      {/* light layer: under the page content, so glass panels catch it through their blur */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[5] overflow-hidden">
        <div
          ref={ambient}
          className="absolute left-0 top-0 will-change-transform"
          style={{
            opacity: 0,
            background:
              'radial-gradient(closest-side, rgba(255,150,50,0.17), rgba(255,138,31,0.07) 42%, rgba(255,138,31,0.02) 70%, transparent)',
          }}
        />
        <div
          ref={pool}
          className="absolute left-0 top-0 will-change-transform"
          style={{
            width: 600,
            height: 90,
            opacity: 0,
            background: 'radial-gradient(closest-side, rgba(255,138,31,0.32), rgba(255,138,31,0.1) 50%, transparent)',
          }}
        />
      </div>
      {/* the figure: above the content, below fog wipe, particles and grain */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
        <div
          ref={wrap}
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: BASE_W, height: BASE_H, transformOrigin: '0 0', opacity: 0 }}
        >
          <KeeperArt
            refs={g}
            onEnter={() => setHover(true)}
            onLeave={() => setHover(false)}
          />
        </div>
        <div
          ref={whisperEl}
          className="absolute left-0 top-0 text-center font-type text-[13px] leading-snug text-mist"
          style={{ width: WHISPER_W, opacity: 0, textShadow: '0 0 8px rgba(7,8,15,0.95), 0 0 2px rgba(7,8,15,1)' }}
        >
          <span
            className="inline-block transition-[opacity,filter] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ opacity: whisper ? 0.92 : 0, filter: whisper ? 'blur(0)' : 'blur(3px)' }}
          >
            {whisper}
          </span>
        </div>
      </div>
    </>
  )
}

type GRefs = {
  body: RefObject<SVGGElement | null>
  robe: RefObject<SVGGElement | null>
  hood: RefObject<SVGGElement | null>
  arm: RefObject<SVGGElement | null>
  lantern: RefObject<SVGGElement | null>
  glow: RefObject<SVGGElement | null>
  flame: RefObject<SVGGElement | null>
  eyes: RefObject<SVGGElement | null>
  wash: RefObject<SVGGElement | null>
}

const ROBE = 'M118 150 C 100 210, 86 330, 70 546 C 120 552, 190 552, 238 546 C 224 400, 206 250, 186 150 Z'
const HOOD = 'M110 166 C 98 116, 118 54, 152 40 C 184 28, 204 72, 200 112 C 198 142, 194 162, 188 176 C 166 186, 130 184, 110 166 Z'
const SLEEVE = 'M140 188 C 116 196, 88 208, 62 222 L 70 240 C 96 230, 124 222, 156 214 Z'

/**
 * Faceless hood with two faint ember eyes, a long plain robe whose hem dissolves into mist,
 * and a sleeve holding a lantern. No hands, no tatters. Default facing: lantern to the left.
 */
function KeeperArt({ refs, onEnter, onLeave }: { refs: GRefs; onEnter: () => void; onLeave: () => void }) {
  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      width={BASE_W}
      height={BASE_H}
      overflow="visible"
      style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="keeper-robe" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1b1f3a" />
          <stop offset="45%" stopColor="#0f1226" />
          <stop offset="100%" stopColor="#06070e" />
        </linearGradient>
        <radialGradient id="keeper-wash" cx="56" cy="268" r="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.45" />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lantern-glass" cx="50%" cy="60%" r="65%">
          <stop offset="0%" stopColor="#fff1c9" />
          <stop offset="40%" stopColor="#ffb35c" />
          <stop offset="100%" stopColor="#c55400" />
        </radialGradient>
        <radialGradient id="lantern-glow">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.5" />
          <stop offset="25%" stopColor="#ff8a1f" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <mask id="keeper-hem" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="600">
          <rect x="0" y="0" width="300" height="560" fill="url(#keeper-hem-v)" />
        </mask>
        <linearGradient id="keeper-hem-v" x1="0" y1="0" x2="0" y2="560" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="80%" stopColor="#fff" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
        <filter id="eye-blur" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      <g ref={refs.body}>
        {/* the figure itself is the only thing that takes the pointer */}
        <g style={{ pointerEvents: 'visiblePainted' }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
          {/* robe, its hem fading into the mist */}
          <g ref={refs.robe} mask="url(#keeper-hem)">
            <path d={ROBE} fill="url(#keeper-robe)" />
            <g ref={refs.wash}>
              <path d={ROBE} fill="url(#keeper-wash)" />
            </g>
            <path d="M118 150 C 100 210, 86 330, 70 546" fill="none" stroke="#c9d4ec" strokeOpacity="0.1" strokeWidth="3" transform="translate(-1 0)" />
            <g fill="none" stroke="#03040a" strokeOpacity="0.7" strokeWidth="2.2" strokeLinecap="round">
              <path d="M132 230 C 124 320, 116 420, 112 540" />
              <path d="M162 240 C 162 330, 166 430, 172 542" />
              <path d="M190 260 C 198 350, 206 450, 212 540" />
            </g>
            <path d="M118 150 C 100 210, 86 330, 70 546" fill="none" stroke="#ffb35c" strokeOpacity="0.22" strokeWidth="1.5" />
          </g>

          {/* hood */}
          <g ref={refs.hood}>
            <path d={HOOD} fill="url(#keeper-robe)" />
            <path d={HOOD} fill="url(#keeper-wash)" />
            <path d="M110 166 C 98 116, 118 54, 152 40" fill="none" stroke="#ffb35c" strokeOpacity="0.25" strokeWidth="1.5" />
            <path
              d="M118 112 C 122 76, 136 50, 154 42 C 168 36, 180 44, 188 58"
              fill="none"
              stroke="#c9d4ec"
              strokeOpacity="0.28"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            {/* faceless void */}
            <path d="M118 152 C 112 120, 124 88, 147 82 C 166 78, 172 104, 168 130 C 165 150, 152 166, 133 167 Z" fill="#010104" />
            {/* two faint ember eyes */}
            <g ref={refs.eyes}>
              <g className="anim-ember-slow">
                <g filter="url(#eye-blur)" fill="#ffb35c">
                  <circle cx="134" cy="118" r="4.2" />
                  <circle cx="152" cy="116" r="4.2" />
                </g>
                <circle cx="134" cy="118" r="1" fill="#fff1c9" opacity="0.8" />
                <circle cx="152" cy="116" r="1" fill="#fff1c9" opacity="0.8" />
              </g>
            </g>
          </g>

          {/* sleeve and lantern */}
          <g ref={refs.arm}>
            <path d={SLEEVE} fill="url(#keeper-robe)" />
            <path d={SLEEVE} fill="url(#keeper-wash)" />
            <ellipse cx="65" cy="231" rx="7" ry="10" fill="#05060c" transform="rotate(-20 65 231)" />
            <g ref={refs.lantern}>
              <g ref={refs.glow} style={{ pointerEvents: 'none' }}>
                <circle cx="56" cy="276" r="128" fill="url(#lantern-glow)" className="anim-ember" />
              </g>
              <path d="M60 232 L57 246" stroke="#2a2418" strokeWidth="1.6" />
              <circle cx="56" cy="248" r="3.5" fill="none" stroke="#2a2418" strokeWidth="1.6" />
              <path d="M44 260 L68 260 L63 251 L49 251 Z" fill="#1a150d" />
              <rect x="42" y="260" width="28" height="38" rx="3" fill="url(#lantern-glass)" className="anim-ember" />
              <g ref={refs.flame}>
                <path d="M56 293 C 49 286, 50 278, 56 268 C 62 278, 63 286, 56 293 Z" fill="#fff1c9" className="anim-flame" />
              </g>
              <g stroke="#1a150d" strokeWidth="2.2" fill="none">
                <rect x="42" y="260" width="28" height="38" rx="3" />
                <path d="M51 260 V298 M61 260 V298" strokeWidth="1.2" />
              </g>
              <path d="M40 298 L72 298 L68 305 L44 305 Z" fill="#1a150d" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  )
}
