import type { CSSProperties } from 'react'

/** Shared placement of scene light sources (moon, pumpkins) so other layers can line up with them. */

/** The moon's box (the disc sits at its centre, ~31% of its width). */
export const MOON_BOX: CSSProperties = {
  left: 'clamp(-10px, 4vw, 120px)',
  // low enough that the halo never crops at the top, even with the 60 px descent on /r/:id
  top: 'clamp(8px, 3vh, 48px)',
  width: 'clamp(140px, 17vw, 280px)',
  aspectRatio: '1',
}

type PumpkinSpec = { x: number; y: number; size: number; seed: number; mobile?: boolean; face: 0 | 1 | 2 }

/** Pumpkin positions in the ground box (1600 x 500); Wisps' embers rise from these. */
export const PUMPKINS: PumpkinSpec[] = [
  { x: 515, y: 462, size: 1.05, seed: 3, mobile: true, face: 0 },
  { x: 872, y: 465, size: 0.85, seed: 8, mobile: true, face: 1 },
  { x: 1235, y: 460, size: 1, seed: 13, face: 2 },
]
