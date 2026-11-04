import { prefersReducedMotion } from '../styles/motion'

/**
 * First-load intro (~1.6 s), played once per session and skippable by any click
 * or key. Shared by the Scene (veil, moon, fog) and the Hero (rising letters).
 */
const KEY = 'resurrect:intro-seen'
export const INTRO_MS = 1600

function decide(): boolean {
  if (typeof window === 'undefined' || prefersReducedMotion()) return false
  try {
    if (window.sessionStorage.getItem(KEY)) return false
    window.sessionStorage.setItem(KEY, '1')
  } catch {
    // storage blocked: still play, it is harmless
  }
  return true
}

let playing = decide()
const listeners = new Set<() => void>()

function finish() {
  if (!playing) return
  playing = false
  listeners.forEach((l) => l())
  window.removeEventListener('pointerdown', finish)
  window.removeEventListener('keydown', finish)
}

if (playing) {
  window.addEventListener('pointerdown', finish)
  window.addEventListener('keydown', finish)
  window.setTimeout(finish, INTRO_MS + 900)
}

export const intro = {
  /** True only while the intro is still running. */
  playing: () => playing,
  /** Whether the intro was scheduled at load (fixed for the session). */
  played: playing,
  skip: finish,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
