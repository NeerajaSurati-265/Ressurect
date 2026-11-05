import { gateWillShow } from '../gate/gateState'
import { prefersReducedMotion } from '../styles/motion'

/**
 * First-load intro (~1.6 s), played once per session and skippable by any click
 * or key. Shared by the Scene (veil, moon, fog) and the Hero (rising letters).
 *
 * When the entry gate shows, the intro is *held*: the letters wait, hidden, until the gate's
 * lantern reveal has finished and calls `intro.start()`, so there is never a double intro.
 * The Scene's own veil/moon intro is skipped then (the reveal already opens the night).
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

const scheduled = decide()
let playing = scheduled
let held = scheduled && gateWillShow
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function finish() {
  if (!playing || held) return
  playing = false
  notify()
  window.removeEventListener('pointerdown', finish)
  window.removeEventListener('keydown', finish)
}

function arm() {
  window.addEventListener('pointerdown', finish)
  window.addEventListener('keydown', finish)
  window.setTimeout(finish, INTRO_MS + 900)
}

if (playing && !held) arm()

export const intro = {
  /** True only while the intro is still running (or held behind the gate). */
  playing: () => playing,
  /** True while the intro waits behind the entry gate. */
  held: () => held,
  /** Whether the letters intro was scheduled at load (fixed for the session). */
  played: scheduled,
  /** Whether the Scene's veil/moon intro plays (not when the gate's reveal replaces it). */
  sceneIntro: scheduled && !gateWillShow,
  skip: finish,
  /** Called by the gate after its reveal: the held intro begins now. */
  start() {
    if (!held) return
    held = false
    notify()
    arm()
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
