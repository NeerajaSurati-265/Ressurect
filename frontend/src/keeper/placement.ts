/**
 * Where the Keeper may stand. Pure geometry over viewport rects: it stands BESIDE its
 * anchor (the side with more room), never over text, buttons, inputs or panels.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Figure proportions in SVG units (see Keeper.tsx VIEWBOX). */
export const VB = { x: 24, y: 24, w: 228, h: 536 }
export const RATIO = VB.w / VB.h
/** Space reserved under the figure for a whisper. */
export const WHISPER_H = 38
/** Minimum whisper column width; narrow figures reserve extra room either side. */
export const WHISPER_W = 160

const EDGE = 12
const PAD = 10

export type Side = 'left' | 'right'

export interface Placement {
  x: number
  y: number
  /** figure height in px */
  h: number
  side: Side
}

export interface SolveOpts {
  vw: number
  vh: number
  anchor: Rect
  obstacles: Rect[]
  /** preferred figure height */
  size: number
  minSize: number
  /** gap between anchor and figure */
  gap: number
  /** stand on the ground at the viewport's bottom edge instead of beside the anchor's middle */
  ground: boolean
  whisper: boolean
  prevSide?: Side
}

/** Rect reserved for a figure at (x, y, h): the figure plus the whisper strip, padded. */
export function reserved(x: number, y: number, h: number, whisper: boolean): Rect {
  const w = h * RATIO
  const extra = whisper ? Math.max(0, (WHISPER_W - w) / 2) : 0
  return { x: x - extra - PAD, y: y - PAD, w: w + extra * 2 + PAD * 2, h: h + (whisper ? WHISPER_H : 0) + PAD * 2 }
}

export function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function collides(r: Rect, obstacles: Rect[]) {
  for (const o of obstacles) if (overlaps(r, o)) return true
  return false
}

function inView(r: Rect, vw: number, vh: number) {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= vw && r.y + r.h <= vh
}

export function fits(p: Placement, o: SolveOpts) {
  const r = reserved(p.x, p.y, p.h, o.whisper)
  return inView(r, o.vw, o.vh) && !collides(r, o.obstacles)
}

/** Vertical positions to try, nearest to the ideal first. */
function yCandidates(ideal: number, minY: number, maxY: number) {
  const out: number[] = []
  const clampIdeal = Math.min(maxY, Math.max(minY, ideal))
  out.push(clampIdeal)
  for (let d = 24; d < 1400; d += 24) {
    const up = clampIdeal - d
    const down = clampIdeal + d
    if (up < minY && down > maxY) break
    if (up >= minY) out.push(up)
    if (down <= maxY) out.push(down)
  }
  return out
}

export function solve(o: SolveOpts): Placement | null {
  const { vw, vh, anchor: a } = o
  const room = { left: a.x, right: vw - (a.x + a.w) }
  let sides: Side[] = room.right >= room.left ? ['right', 'left'] : ['left', 'right']
  // hysteresis: keep the current side unless the other is clearly roomier
  if (o.prevSide && room[o.prevSide] >= 0.8 * room[o.prevSide === 'left' ? 'right' : 'left']) {
    sides = [o.prevSide, o.prevSide === 'left' ? 'right' : 'left']
  }
  const whisperH = o.whisper ? WHISPER_H : 0

  for (let h = o.size; h >= o.minSize - 0.5; h *= 0.9) {
    const w = h * RATIO
    for (const side of sides) {
      let x: number
      if (o.ground) x = side === 'right' ? vw - EDGE - w - PAD : EDGE + PAD
      else x = side === 'right' ? a.x + a.w + o.gap : a.x - o.gap - w
      const minX = EDGE + PAD
      const maxX = vw - EDGE - PAD - w
      x = Math.min(maxX, Math.max(minX, x))
      // must stay clear of the anchor horizontally
      if (side === 'right' ? x < a.x + a.w + 8 : x + w > a.x - 8) continue
      const minY = EDGE + PAD
      const maxY = vh - EDGE - PAD - h - whisperH
      if (maxY < minY) continue
      // the lantern sits ~46% down the figure; line it up with the anchor's upper middle
      const focusY = a.y + Math.min(a.h * 0.5, 150)
      const ideal = o.ground ? vh - h - whisperH - (24 + vh * 0.015) : focusY - h * 0.46
      for (const y of yCandidates(ideal, minY, maxY)) {
        const p = { x, y, h, side }
        if (fits(p, o)) return p
      }
    }
  }
  return null
}

/**
 * Fallback when nothing fits beside the anchor: the nearest free spot anywhere on screen,
 * scanning a coarse grid. Keeps the Keeper present in narrow layouts.
 */
export function solveAnywhere(o: SolveOpts): Placement | null {
  const { vw, vh, anchor: a } = o
  const cx = a.x + a.w / 2
  const cy = a.y + Math.min(a.h * 0.5, 150)
  for (let h = o.size; h >= o.minSize - 0.5; h *= 0.88) {
    const w = h * RATIO
    let best: Placement | null = null
    let bestD = Infinity
    for (let x = EDGE + PAD; x <= vw - EDGE - PAD - w; x += 32) {
      for (let y = EDGE + PAD; y <= vh - EDGE - PAD - h - (o.whisper ? WHISPER_H : 0); y += 32) {
        const p: Placement = { x, y, h, side: x + w / 2 > cx ? 'right' : 'left' }
        const d = Math.hypot(x + w / 2 - cx, y + h * 0.46 - cy)
        if (d < bestD && fits(p, o)) {
          best = p
          bestD = d
        }
      }
    }
    if (best) return best
  }
  return null
}

/** Viewport rects of everything the Keeper must never cover. */
const OBSTACLE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'input', 'textarea', 'select', 'label', 'li', 'pre', 'code',
  'table', 'img', '[role="log"]', '[data-keeper-anchor]', '[data-keeper-obstacle]',
  '.mist-glass', '.parchment-glass', '.seance-glass', '.risen-glass', '.ghost-glass',
].join(',')

export function collectObstacles(vw: number, vh: number): Rect[] {
  const out: Rect[] = []
  const roots = document.querySelectorAll('#main, footer')
  roots.forEach((root) => {
    root.querySelectorAll(OBSTACLE_SELECTOR).forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 3 || r.height < 3) return // sr-only and collapsed nodes
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height })
    })
  })
  return out
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
