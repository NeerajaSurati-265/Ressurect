import { useMemo } from 'react'
import { GroundBox } from './Ground'
import { mulberry32 } from './hooks'

/** Tall grass and weed silhouettes in a strip; thicker toward both corners to frame the scene. */
function weeds(seed: number, count: number) {
  const rand = mulberry32(seed)
  let blades = ''
  let rims = ''
  for (let i = 0; i < count; i++) {
    const u = rand()
    // bias toward the corners
    const x = u < 0.5 ? Math.pow(u * 2, 1.6) * 800 : 1600 - Math.pow((1 - u) * 2, 1.6) * 800
    const edge = 1 - Math.min(x, 1600 - x) / 800 // 1 at the corners, 0 in the middle
    const h = 20 + rand() * 14 + edge * edge * 42 * rand()
    const lean = (rand() - 0.5) * h * 0.8
    const w = 1.2 + rand() * 1.6
    const by = 500
    const d = `M${(x - w).toFixed(1)} ${by}Q${(x + lean * 0.35).toFixed(1)} ${(by - h * 0.6).toFixed(1)} ${(x + lean).toFixed(1)} ${(by - h).toFixed(1)}Q${(x + w * 0.5 + lean * 0.4).toFixed(1)} ${(by - h * 0.5).toFixed(1)} ${(x + w).toFixed(1)} ${by}Z`
    blades += d
    // a few blades on the moon side catch a thin cold rim
    if (x < 900 && rand() < 0.18) rims += `M${(x - w).toFixed(1)} ${(by - h * 0.3).toFixed(1)}Q${(x + lean * 0.3 - w * 0.6).toFixed(1)} ${(by - h * 0.65).toFixed(1)} ${(x + lean).toFixed(1)} ${(by - h).toFixed(1)}`
  }
  return { blades, rims }
}

/** The nearest layer: dark earth lip and grass silhouettes along the bottom edge (crisp, no blur). */
export function Foreground({ mobile }: { mobile: boolean }) {
  const art = useMemo(() => weeds(77, mobile ? 120 : 220), [mobile])
  return (
    <GroundBox>
      <path d="M-20 482Q200 474 420 480T860 479T1300 477T1640 474V520H-20Z" fill="#030408" />
      <path d={art.blades} fill="#030408" />
      <path d={art.rims} fill="none" stroke="#b9c7e6" strokeOpacity="0.16" strokeWidth="0.7" />
    </GroundBox>
  )
}
