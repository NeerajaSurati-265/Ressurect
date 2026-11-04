import { useEffect, useRef } from 'react'
import { attachCanvas } from './particles'

/** The single full-screen particle canvas. Mount once in the layout. */
export function ParticleLayer() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => (ref.current ? attachCanvas(ref.current) : undefined), [])
  return <canvas ref={ref} aria-hidden="true" className="fx-particles" />
}
