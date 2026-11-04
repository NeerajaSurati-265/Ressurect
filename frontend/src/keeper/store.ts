import { useEffect, useRef } from 'react'

/**
 * The Keeper's tiny store. Screens tell the Keeper where to stand and how to feel;
 * the Keeper never reads app state. One module-level value plus listeners.
 */

/** Elements marked with data-keeper-anchor="<name>". */
export type KeeperAnchor =
  | 'url-input'
  | 'grave'
  | 'seance'
  | 'result-card'
  | 'ghost-card'
  | 'cannot-rise'
  | 'turned-away'
  | 'home-path'

export type KeeperMood =
  /** landing: lantern lighting the URL input; wanders after 25 s idle */
  | 'idle'
  /** ritual start: lantern raised high while the stone rises */
  | 'rising'
  /** summoning / building: hovering, attentive; brightens on new log lines */
  | 'seance'
  /** checking_pulse: lantern lowered toward the grave, leaning in */
  | 'listening'
  /** alive, first beat: steps back, lantern lifted in triumph */
  | 'triumph'
  /** alive, after: beside the result card, lantern tilted toward the focus element */
  | 'presenting'
  /** failed, first beat: jolts away from the grave */
  | 'recoil'
  /** failed, after: keeps a wary, steady vigil by the ghost card */
  | 'vigil'
  /** cannot_rise / expired: head bowed, lantern low and dim */
  | 'mourning'
  /** API turned the ritual away: stands back from the locked gate */
  | 'barred'
  /** 404: holds the lantern out toward the way home */
  | 'guiding'

export interface KeeperDirective {
  mood: KeeperMood
  anchor: KeeperAnchor | null
  /** A few plain words shown faintly beside the Keeper. Decorative (aria-hidden). */
  whisper?: string
  /** data-keeper-focus="<name>" element the lantern tilts toward (e.g. the Visit button). */
  focus?: string
}

export type KeeperEvent = 'line' | 'beat'

type Listener = (d: KeeperDirective) => void
type EventListener = (e: KeeperEvent) => void

const DEFAULT: KeeperDirective = { mood: 'idle', anchor: 'url-input' }
let current: KeeperDirective = DEFAULT
const listeners = new Set<Listener>()
const eventListeners = new Set<EventListener>()

function same(a: KeeperDirective, b: KeeperDirective) {
  return a.mood === b.mood && a.anchor === b.anchor && a.whisper === b.whisper && a.focus === b.focus
}

export function setKeeper(d: KeeperDirective) {
  if (same(d, current)) return
  current = d
  listeners.forEach((l) => l(d))
}

export function getKeeper() {
  return current
}

export function subscribeKeeper(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** One-off cues: a new log line arrived, a heartbeat spike passed. */
export function keeperEvent(e: KeeperEvent) {
  eventListeners.forEach((l) => l(e))
}

export function subscribeKeeperEvents(l: EventListener) {
  eventListeners.add(l)
  return () => {
    eventListeners.delete(l)
  }
}

/** A step in a short choreography: the directive, held for `hold` ms before the next step. */
export type KeeperStep = KeeperDirective & { hold?: number }

/**
 * Plays `steps` whenever `key` changes: each step is held for its `hold`, the last stays.
 * Screens use this on status changes (e.g. triumph at the grave, then present the result card).
 */
export function useKeeperScript(key: string | null, steps: KeeperStep[]) {
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  useEffect(() => {
    if (key === null) return
    const list = stepsRef.current
    const timers: number[] = []
    let at = 0
    list.forEach((s, i) => {
      const { hold, ...d } = s
      if (i === 0) setKeeper(d)
      else timers.push(window.setTimeout(() => setKeeper(d), at))
      at += hold ?? 0
    })
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [key])
}
