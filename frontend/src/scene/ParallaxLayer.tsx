import type { CSSProperties, ReactNode } from 'react'

/**
 * A full-viewport layer that shifts against the pointer by `depth` px.
 * It overscans the viewport by 24 px on every side (more than the largest
 * shift), so moving it never reveals an edge. `style` is merged (e.g. a blend mode).
 */
export function ParallaxLayer({ depth, children, style }: { depth: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="parallax-layer" style={{ ...style, '--d': depth } as CSSProperties}>
      {children}
    </div>
  )
}
