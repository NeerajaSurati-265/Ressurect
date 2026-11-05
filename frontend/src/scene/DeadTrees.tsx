import { useMemo, type CSSProperties } from 'react'
import { GroundBox } from './Ground'
import { mulberry32 } from './hooks'

type Form = 'spread' | 'tall' | 'gnarled' | 'lean'
type TreeSpec = { x: number; y: number; scale: number; seed: number; form: Form; flip?: boolean; mobile?: boolean }

const TREES: TreeSpec[] = [
  { x: 150, y: 420, scale: 1.15, seed: 11, form: 'gnarled' },
  { x: 390, y: 410, scale: 0.8, seed: 23, form: 'tall' },
  { x: 620, y: 402, scale: 0.6, seed: 5, form: 'spread', mobile: true },
  { x: 820, y: 396, scale: 0.46, seed: 42, form: 'tall', mobile: true },
  { x: 1000, y: 405, scale: 0.68, seed: 7, form: 'lean', flip: true, mobile: true },
  { x: 1270, y: 415, scale: 0.92, seed: 3, form: 'spread' },
  { x: 1500, y: 425, scale: 1.2, seed: 19, form: 'lean' },
]

const FORMS: Record<Form, { spread: [number, number]; decay: number; bend: number; trunk: number; depth: number; lean: number; three: number }> = {
  spread: { spread: [0.42, 0.8], decay: 0.68, bend: 0.6, trunk: 58, depth: 7, lean: 0.12, three: 0.35 },
  tall: { spread: [0.22, 0.5], decay: 0.74, bend: 0.45, trunk: 80, depth: 7, lean: 0.08, three: 0.2 },
  gnarled: { spread: [0.3, 0.95], decay: 0.64, bend: 1.1, trunk: 64, depth: 7, lean: 0.22, three: 0.4 },
  lean: { spread: [0.3, 0.7], decay: 0.7, bend: 0.7, trunk: 70, depth: 7, lean: 0.38, three: 0.25 },
}

type Buckets = Map<number, string>
type SwayGroup = { ox: number; oy: number; buckets: Buckets; dur: number; delay: number; amp: number }
type Grown = { trunk: Buckets; sway: SwayGroup[] }

const f1 = (n: number) => n.toFixed(1)

function addTo(b: Buckets, w: number, d: string) {
  const key = w < 1 ? Math.max(0.45, Math.round(w * 4) / 4) : Math.round(w * 2) / 2
  b.set(key, (b.get(key) ?? '') + d)
}

/**
 * Recursively grows a bare tree with per-form character, tapered limbs (each split in two by
 * de Casteljau so the width steps down mid-branch) and a fine generation of crooked twigs at the
 * tips. Limbs at the outer levels are collected into sway groups pivoting at their joint.
 */
function growTree({ x, y, scale, seed, form, flip }: TreeSpec, swayable: boolean): Grown {
  const F = FORMS[form]
  const rand = mulberry32(seed)
  const trunk: Buckets = new Map()
  const sway: SwayGroup[] = []
  const swayLevel = 3 // limbs this many forks out from the trunk start swaying

  const branch = (
    bx: number, by: number, ang: number, len: number, w: number, depth: number, level: number,
    target: Buckets, ox: number, oy: number,
  ) => {
    let tgt = target
    let tx = ox
    let ty = oy
    if (swayable && level === swayLevel && sway.length < 10) {
      const g: SwayGroup = {
        ox: bx, oy: by, buckets: new Map(),
        dur: 6.5 + rand() * 4.5, delay: -rand() * 10, amp: (1 + rand() * 1.2) * (form === 'gnarled' ? 0.8 : 1),
      }
      sway.push(g)
      tgt = g.buckets
      tx = bx
      ty = by
    }
    const bend = (rand() - 0.5) * F.bend
    const ex = bx + Math.cos(ang) * len
    const ey = by + Math.sin(ang) * len
    const cx = bx + Math.cos(ang + bend) * len * 0.55
    const cy = by + Math.sin(ang + bend) * len * 0.55
    // split the quadratic at t = 0.5 so the limb tapers in two steps
    const mx = 0.25 * bx + 0.5 * cx + 0.25 * ex
    const my = 0.25 * by + 0.5 * cy + 0.25 * ey
    addTo(tgt, w, `M${f1(bx - tx)} ${f1(by - ty)}Q${f1((bx + cx) / 2 - tx)} ${f1((by + cy) / 2 - ty)} ${f1(mx - tx)} ${f1(my - ty)}`)
    addTo(tgt, w * 0.8, `M${f1(mx - tx)} ${f1(my - ty)}Q${f1((cx + ex) / 2 - tx)} ${f1((cy + ey) / 2 - ty)} ${f1(ex - tx)} ${f1(ey - ty)}`)

    if (depth === 0 || len < 3.5) {
      // fine twigs: short crooked two-segment sprigs
      const n = 2 + Math.floor(rand() * 3)
      for (let i = 0; i < n; i++) {
        const a = ang + (rand() - 0.5) * 1.8
        const l = (3 + rand() * 6) * Math.max(0.6, scale)
        const kx = ex + Math.cos(a) * l * 0.5
        const ky = ey + Math.sin(a) * l * 0.5
        const a2 = a + (rand() - 0.5) * 0.9
        addTo(tgt, 0.45, `M${f1(ex - tx)} ${f1(ey - ty)}L${f1(kx - tx)} ${f1(ky - ty)}L${f1(kx + Math.cos(a2) * l * 0.5 - tx)} ${f1(ky + Math.sin(a2) * l * 0.5 - ty)}`)
      }
      return
    }
    const n = rand() < F.three ? 3 : 2
    for (let i = 0; i < n; i++) {
      const side = n === 2 ? (i === 0 ? -1 : 1) : i - 1
      const [s0, s1] = F.spread
      let a = ang + side * (s0 + rand() * (s1 - s0)) + (rand() - 0.5) * 0.3
      a = Math.min(-0.1, Math.max(-Math.PI + 0.1, a))
      const lenK = F.decay + rand() * 0.16 - (side !== 0 && rand() < 0.25 ? 0.18 : 0)
      branch(ex, ey, a, len * lenK, w * 0.64, depth - 1, level + 1, tgt, tx, ty)
    }
    // the odd stub: a short broken spur
    if (level > 0 && level < 4 && rand() < 0.3) {
      const a = ang + (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.5)
      const l = len * 0.22
      addTo(tgt, w * 0.5, `M${f1(mx - tx)} ${f1(my - ty)}L${f1(mx + Math.cos(a) * l - tx)} ${f1(my + Math.sin(a) * l - ty)}`)
    }
  }
  const lean = (flip ? -1 : 1) * (F.lean * (0.6 + rand() * 0.6))
  branch(x, y, -Math.PI / 2 + lean, F.trunk * scale, 11 * scale, F.depth, 0, trunk, 0, 0)
  return { trunk, sway }
}

/** Aerial perspective: far trees are lighter, bluer and softer; near trees near-black and crisp. */
function depthOf(scale: number) {
  if (scale < 0.7) return { ink: '#232b52', opacity: 0.82, filter: 'far' as const, rim: 0 }
  if (scale < 0.9) return { ink: '#11152d', opacity: 1, filter: 'mid' as const, rim: 0.16 }
  return { ink: '#05060d', opacity: 1, filter: 'near' as const, rim: 0.28 }
}

function roots(t: TreeSpec) {
  const s = t.scale
  const { x, y } = t
  return `M${x - 22 * s} ${y + 5}Q${x - 10 * s} ${y + 1} ${x - 5 * s} ${y - 12 * s}L${x + 5 * s} ${y - 12 * s}Q${x + 9 * s} ${y} ${x + 24 * s} ${y + 6}Q${x + 8 * s} ${y + 2} ${x + 2 * s} ${y + 6}Q${x - 4 * s} ${y + 2} ${x - 22 * s} ${y + 5}Z`
}

function Paths({ buckets, minW = 0 }: { buckets: Buckets; minW?: number }) {
  return (
    <>
      {[...buckets].filter(([w]) => w >= minW).map(([w, d]) => (
        <path key={w} d={d} strokeWidth={w} />
      ))}
    </>
  )
}

/**
 * Dead trees in two SVGs with identical geometry: a static one (trunks and main limbs, with
 * bark displacement and depth-of-field blur, rasterised once) and a light one holding only the
 * outer limbs, which sway slowly and out of phase (CSS, stepped so it repaints ~6 fps; none
 * under reduced motion). The sway SVG has its own compositor layer so it never re-rasterises
 * the filtered trunks.
 */
export function DeadTrees({ mobile, reduced = false }: { mobile: boolean; reduced?: boolean }) {
  const trees = useMemo(
    () =>
      TREES.filter((t) => !mobile || t.mobile).map((t) => ({ spec: t, d: depthOf(t.scale), grown: growTree(t, t.scale >= 0.66) })),
    [mobile],
  )
  return (
    <>
      <GroundBox>
        <defs>
          <filter id="tree-near" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="tree-mid" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="9" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="d" />
            <feGaussianBlur in="d" stdDeviation="0.7" />
          </filter>
          <filter id="tree-far" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>
        <g strokeLinecap="round" fill="none">
          {trees.map(({ spec, d, grown }) => (
            <g key={spec.seed} filter={`url(#tree-${d.filter})`} opacity={d.opacity}>
              {/* cold rim light on the moon side: a pale copy nudged up-left, under the silhouette */}
              {d.rim > 0 && (
                <g stroke="#b9c7e6" strokeOpacity={d.rim} transform="translate(-1.3 -0.7)">
                  <Paths buckets={grown.trunk} minW={1.5} />
                </g>
              )}
              <g stroke={d.ink}>
                <path d={roots(spec)} fill={d.ink} stroke="none" />
                <Paths buckets={grown.trunk} />
              </g>
            </g>
          ))}
        </g>
      </GroundBox>
      <GroundBox className="fx-own-layer">
        <g strokeLinecap="round" fill="none">
          {trees.map(({ spec, d, grown }) =>
            grown.sway.map((g, i) => (
              <g key={`${spec.seed}-${i}`} transform={`translate(${f1(g.ox)} ${f1(g.oy)})`} opacity={d.opacity}>
                <g
                  className={reduced ? undefined : 'branch-sway'}
                  style={{ animationDuration: `${g.dur.toFixed(2)}s`, animationDelay: `${g.delay.toFixed(2)}s`, '--sw': g.amp.toFixed(2) } as CSSProperties}
                >
                  {d.rim > 0 && (
                    <g stroke="#b9c7e6" strokeOpacity={d.rim * 0.8} transform="translate(-1 -0.6)">
                      <Paths buckets={g.buckets} minW={1.2} />
                    </g>
                  )}
                  <g stroke={d.ink}>
                    <Paths buckets={g.buckets} />
                  </g>
                </g>
              </g>
            )),
          )}
        </g>
      </GroundBox>
    </>
  )
}
