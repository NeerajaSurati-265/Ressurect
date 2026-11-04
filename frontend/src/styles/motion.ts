import type { Transition } from 'framer-motion'

/** Shared motion language. UI: ease-out-expo. Physical objects: springs with weight. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const

/** Durations in seconds. */
export const DUR = {
  micro: 0.18,
  microSlow: 0.25,
  ui: 0.4,
  uiSlow: 0.5,
  cinematic: 1.6,
  cinematicLong: 2.5,
} as const

/** Stagger for groups, seconds (40-80 ms). */
export const STAGGER = 0.06

export const SPRING = {
  /** Tombstones, ghost, falling stone: weighty with slight overshoot. */
  heavy: { type: 'spring', stiffness: 120, damping: 14, mass: 1 } satisfies Transition,
  /** Cards and panels. */
  soft: { type: 'spring', stiffness: 200, damping: 26 } satisfies Transition,
} as const

export const uiTransition = (delay = 0): Transition => ({ duration: DUR.ui, ease: EASE_OUT_EXPO, delay })
export const microTransition = (delay = 0): Transition => ({ duration: DUR.micro, ease: EASE_OUT_EXPO, delay })

/**
 * Slow, slightly irregular sine float for idle atmosphere. Returns Framer Motion keyframes
 * plus a transition. `seed` varies the period so siblings never sync up.
 */
export function float(amplitude = 6, period = 6, seed = 0) {
  const p = period * (1 + ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * 0.25)
  return {
    animate: { y: [0, -amplitude, amplitude * 0.35, -amplitude * 0.6, 0] },
    transition: { duration: Math.abs(p), ease: 'easeInOut', repeat: Infinity, times: [0, 0.3, 0.55, 0.8, 1] } satisfies Transition,
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
