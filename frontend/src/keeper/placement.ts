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
/**
 * The speech scroll's reserved box, in px. It matches SpeechScroll's real outer size: text
 * max-width 280 px (about 30ch of Special Elite at 17 px) plus 2 x 20 px padding; four lines of
 * 17 px x 1.45 plus padding and the rolled ends. Lines are trimmed to ~110 characters, so four
 * lines is the usual maximum.
 */
export const SCROLL_W = 320
export const SCROLL_H = 128
const SCROLL_GAP = 4

const EDGE = 12
const PAD = 10

export type Side = 'left' | 'right'
/** Where the speech scroll hangs relative to the figure. */
export type ScrollAt = 'below' | 'above'

export interface Placement {
  x: number
  y: number
  /** figure height in px */
  h: number
  side: Side
  /** where the scroll's reserved strip is, or null when this spot has no room for it */
  scroll: ScrollAt | null
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
  /** reserve room for the speech scroll as well */
  scroll: boolean
  prevSide?: Side
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** The figure's rect at (x, y, h), padded. */
export function figureRect(x: number, y: number, h: number): Rect {
  const w = h * RATIO
  return { x: x - PAD, y: y - PAD, w: w + PAD * 2, h: h + PAD * 2 }
}

/**
 * The scroll's box (unpadded) for a figure placement. Its edge nearest the anchor lines up with
 * the figure's, and it extends away from the anchor, so it never reaches back over the content.
 */
export function scrollRect(p: { x: number; y: number; h: number; side: Side }, at: ScrollAt, vw: number): Rect {
  const w = p.h * RATIO
  const sx = clamp(p.side === 'right' ? p.x : p.x + w - SCROLL_W, EDGE, vw - EDGE - SCROLL_W)
  const sy = at === 'below' ? p.y + p.h + SCROLL_GAP : p.y - SCROLL_GAP - SCROLL_H
  return { x: sx, y: sy, w: SCROLL_W, h: SCROLL_H }
}

function pad(r: Rect): Rect {
  return { x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 }
}

/** Every rect a placement occupies: the figure and, if it has one, the scroll strip. */
export function reservedRects(p: Placement, vw: number): Rect[] {
  const out = [figureRect(p.x, p.y, p.h)]
  if (p.scroll) out.push(pad(scrollRect(p, p.scroll, vw)))
  return out
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

export function fits(p: Placement, o: Pick<SolveOpts, 'vw' | 'vh' | 'obstacles'>) {
  for (const r of reservedRects(p, o.vw)) if (!inView(r, o.vw, o.vh) || collides(r, o.obstacles)) return false
  return true
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

const STRIP = SCROLL_H + SCROLL_GAP + PAD

function scrollOptions(o: SolveOpts): Array<ScrollAt | null> {
  if (!o.scroll) return [null]
  // standing on the ground, the scroll hangs above the hood; otherwise below the hem first
  return o.ground ? ['above', 'below'] : ['below', 'above']
}

export function solve(o: SolveOpts): Placement | null {
  const { vw, vh, anchor: a } = o
  const room = { left: a.x, right: vw - (a.x + a.w) }
  let sides: Side[] = room.right >= room.left ? ['right', 'left'] : ['left', 'right']
  // hysteresis: keep the current side unless the other is clearly roomier
  if (o.prevSide && room[o.prevSide] >= 0.8 * room[o.prevSide === 'left' ? 'right' : 'left']) {
    sides = [o.prevSide, o.prevSide === 'left' ? 'right' : 'left']
  }

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
      for (const at of scrollOptions(o)) {
        const above = at === 'above' ? STRIP : 0
        const below = at === 'below' ? STRIP : 0
        const minY = EDGE + PAD + above
        const maxY = vh - EDGE - PAD - h - below
        if (maxY < minY) continue
        // the lantern sits ~46% down the figure; line it up with the anchor's upper middle
        const focusY = a.y + Math.min(a.h * 0.5, 150)
        const ideal = o.ground ? vh - h - below - (24 + vh * 0.015) : focusY - h * 0.46
        for (const y of yCandidates(ideal, minY, maxY)) {
          const p: Placement = { x, y, h, side, scroll: at }
          if (fits(p, o)) return p
        }
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
      for (let y = EDGE + PAD; y <= vh - EDGE - PAD - h; y += 32) {
        const side: Side = x + w / 2 > cx ? 'right' : 'left'
        const d = Math.hypot(x + w / 2 - cx, y + h * 0.46 - cy)
        if (d >= bestD) continue
        for (const at of scrollOptions(o)) {
          const p: Placement = { x, y, h, side, scroll: at }
          if (fits(p, o)) {
            best = p
            bestD = d
            break
          }
        }
      }
    }
    if (best) return best
  }
  return null
}

/**
 * A clear spot for the scroll alone (when the figure has no room for it), nearest to `near`.
 * Keeps `prev` while it stays clear, so the scroll does not hop. Null when nothing is clear.
 */
export function scrollSpot(vw: number, vh: number, obstacles: Rect[], near: { x: number; y: number }, prev?: Rect | null): Rect | null {
  const ok = (r: Rect) => inView(pad(r), vw, vh) && !collides(pad(r), obstacles)
  if (prev && prev.x + SCROLL_W <= vw - EDGE && prev.y + SCROLL_H <= vh - EDGE && ok(prev)) return prev
  let best: Rect | null = null
  let bestD = Infinity
  for (let x = EDGE + PAD; x <= vw - EDGE - PAD - SCROLL_W; x += 24) {
    for (let y = EDGE + PAD; y <= vh - EDGE - PAD - SCROLL_H; y += 24) {
      const d = Math.hypot(x + SCROLL_W / 2 - near.x, y + SCROLL_H / 2 - near.y)
      if (d >= bestD) continue
      const r = { x, y, w: SCROLL_W, h: SCROLL_H }
      if (ok(r)) {
        best = r
        bestD = d
      }
    }
  }
  return best
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
