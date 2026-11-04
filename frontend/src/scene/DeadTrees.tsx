import { useMemo } from 'react'
import { GroundBox } from './Ground'
import { mulberry32 } from './hooks'

type TreeSpec = { x: number; y: number; scale: number; seed: number; mobile?: boolean }

const TREES: TreeSpec[] = [
  { x: 150, y: 420, scale: 1.15, seed: 11 },
  { x: 390, y: 410, scale: 0.8, seed: 23 },
  { x: 620, y: 402, scale: 0.62, seed: 5, mobile: true },
  { x: 820, y: 396, scale: 0.48, seed: 42, mobile: true },
  { x: 1000, y: 405, scale: 0.7, seed: 7, mobile: true },
  { x: 1270, y: 415, scale: 0.95, seed: 3 },
  { x: 1500, y: 425, scale: 1.2, seed: 19 },
]

/** Recursively grows a bare, gnarled tree. Segments are bucketed by width to keep the DOM small. */
function growTree({ x, y, scale, seed }: TreeSpec): Map<number, string> {
  const rand = mulberry32(seed)
  const buckets = new Map<number, string>()
  const push = (w: number, d: string) => {
    const key = Math.max(0.6, Math.round(w * 2) / 2)
    buckets.set(key, (buckets.get(key) ?? '') + d)
  }
  const branch = (bx: number, by: number, ang: number, len: number, w: number, depth: number) => {
    const bend = (rand() - 0.5) * 0.6
    const ex = bx + Math.cos(ang) * len
    const ey = by + Math.sin(ang) * len
    const cx = bx + Math.cos(ang + bend) * len * 0.55
    const cy = by + Math.sin(ang + bend) * len * 0.55
    push(w, `M${bx.toFixed(1)} ${by.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
    if (depth === 0 || len < 4) return
    const n = rand() < 0.3 ? 3 : 2
    for (let i = 0; i < n; i++) {
      const side = n === 2 ? (i === 0 ? -1 : 1) : i - 1
      let a = ang + side * (0.3 + rand() * 0.4) + (rand() - 0.5) * 0.25
      a = Math.min(-0.12, Math.max(-Math.PI + 0.12, a))
      branch(ex, ey, a, len * (0.64 + rand() * 0.16), w * 0.64, depth - 1)
    }
  }
  const trunkLen = 66 * scale
  const lean = (rand() - 0.5) * 0.25
  branch(x, y, -Math.PI / 2 + lean, trunkLen, 11 * scale, 6)
  return buckets
}

/** Aerial perspective: small (far) trees are lighter and bluer, big (near) trees near-black. */
function treeInk(scale: number) {
  if (scale < 0.7) return '#1b2142'
  if (scale < 0.9) return '#0d1024'
  return '#05060d'
}

export function DeadTrees({ mobile }: { mobile: boolean }) {
  const trees = useMemo(
    () => TREES.filter((t) => !mobile || t.mobile).map((t) => ({ spec: t, buckets: growTree(t) })),
    [mobile],
  )
  return (
    <GroundBox>
      <g strokeLinecap="round" fill="none">
        {trees.map(({ spec, buckets }) => {
          const ink = treeInk(spec.scale)
          const near = spec.scale >= 0.7
          return (
            <g key={spec.seed}>
              {/* cold rim light on the moon side: a pale copy nudged up-left, under the dark silhouette */}
              {near && (
                <g stroke="#b9c7e6" strokeOpacity={spec.scale >= 0.9 ? 0.3 : 0.2} transform="translate(-1.3 -0.7)">
                  {[...buckets].filter(([w]) => w >= 1.5).map(([w, d]) => (
                    <path key={w} d={d} strokeWidth={w} />
                  ))}
                </g>
              )}
              <g stroke={ink}>
                {/* root flare */}
                <path
                  d={`M${spec.x - 16 * spec.scale} ${spec.y + 4} Q${spec.x} ${spec.y - 12 * spec.scale} ${spec.x + 16 * spec.scale} ${spec.y + 4} Z`}
                  fill={ink}
                  stroke="none"
                />
                {[...buckets].map(([w, d]) => (
                  <path key={w} d={d} strokeWidth={w} />
                ))}
              </g>
            </g>
          )
        })}
      </g>
    </GroundBox>
  )
}
