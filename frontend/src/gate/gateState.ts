import { useSyncExternalStore } from 'react'

/**
 * The entry gate (promo video + fog and lantern reveal). Decided once, synchronously, when the
 * app loads: it shows only on the first visit to "/" in this browser session, never on a deep
 * link (/r/:id badge links go straight to the resurrection) or the 404.
 *
 *   off        no gate this load
 *   open       the gate or the promo covers the page
 *   revealing  the fog is fully in; the Keeper's lantern is burning the opening
 *   done       the gate is gone
 */
export type GateState = 'off' | 'open' | 'revealing' | 'done'

const KEY = 'resurrect:gate-seen'

function decide(): boolean {
  if (typeof window === 'undefined') return false
  if (window.location.pathname !== '/') return false
  try {
    return !window.sessionStorage.getItem(KEY)
  } catch {
    return true
  }
}

/** Fixed for this page load. */
export const gateWillShow = decide()

let state: GateState = gateWillShow ? 'open' : 'off'
const listeners = new Set<() => void>()

function set(next: GateState) {
  if (next === state) return
  state = next
  listeners.forEach((l) => {
    try {
      l()
    } catch (e) {
      console.warn('[resurrect] gate listener failed', e)
    }
  })
}

export const gate = {
  get: () => state,
  /** True while the gate covers the page (before the reveal starts). */
  isOpen: () => state === 'open',
  /** True until the reveal has finished (open or revealing). */
  isActive: () => state === 'open' || state === 'revealing',
  /** Remember for this session that the visitor came through the gate. */
  markSeen() {
    try {
      window.sessionStorage.setItem(KEY, '1')
    } catch {
      /* storage blocked: the gate may show again on reload, which is harmless */
    }
  },
  /** The fog fully covers the screen: the page underneath may come alive (the Keeper places itself). */
  release() {
    if (state === 'open') set('revealing')
  },
  finish() {
    if (state === 'open' || state === 'revealing') set('done')
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

export function useGateState(): GateState {
  return useSyncExternalStore(gate.subscribe, gate.get, () => 'off' as const)
}
