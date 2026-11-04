import type { ReactNode } from 'react'

/** Shared coordinate box for every ground layer so they line up: 1600 x 500, bottom anchored. */
export const GROUND_VIEWBOX = '0 0 1600 500'

export function GroundBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={`ground-box ${className}`}
      viewBox={GROUND_VIEWBOX}
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}
