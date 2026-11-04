import { GroundBox } from './Ground'

/**
 * A soft horizontal band of cold mist lying between two depth layers.
 * Sits in the shared ground coordinate box (1600 x 500).
 */
export function MistBand({ id, y, h, alpha }: { id: string; y: number; h: number; alpha: number }) {
  return (
    <GroundBox>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fa3c7" stopOpacity="0" />
          <stop offset="55%" stopColor="#8fa3c7" stopOpacity={alpha} />
          <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="-40" y={y} width="1680" height={h} fill={`url(#${id})`} />
    </GroundBox>
  )
}
