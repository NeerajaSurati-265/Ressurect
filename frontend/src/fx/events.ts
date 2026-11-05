import type { ErrorCode } from '@contracts/types'

/**
 * Tiny app-wide event bus. Screens emit what happened; audio and the Keeper listen.
 * Module-level and synchronous; a throwing listener never breaks the emitter or other listeners.
 */
export type RitualPhase = 'summoning' | 'cloning' | 'installing' | 'building' | 'uploading'

export interface FxEvents {
  'ritual-start': { repo: string }
  'phase-change': { phase: RitualPhase }
  'log-lines': { count: number }
  'pulse-attempt': { attempt: number; max: number }
  alive: { live_url: string | null }
  failed: { cause: string; fix: string; command: string | null; source: 'llm' | 'fallback' }
  'cannot-rise': { summary: string }
  'turned-away': { code: ErrorCode }
  expired: Record<string, never>
  keystroke: Record<string, never>
  /** the landing page is showing (not in the original list: needed for the landing line) */
  landing: Record<string, never>
  /** the 404 screen is showing (not in the original list: needed for the 404 line) */
  lost: Record<string, never>
}

export type FxEventName = keyof FxEvents
type Handler<K extends FxEventName> = (payload: FxEvents[K]) => void
type AnyHandler = <K extends FxEventName>(name: K, payload: FxEvents[K]) => void

const handlers = new Map<FxEventName, Set<Handler<never>>>()
const anyHandlers = new Set<AnyHandler>()

function safe(fn: () => void) {
  try {
    fn()
  } catch (e) {
    console.warn('[resurrect] fx listener failed', e)
  }
}

export function emit<K extends FxEventName>(name: K, ...[payload]: FxEvents[K] extends Record<string, never> ? [FxEvents[K]?] : [FxEvents[K]]) {
  const p = (payload ?? {}) as FxEvents[K]
  handlers.get(name)?.forEach((h) => safe(() => (h as Handler<K>)(p)))
  anyHandlers.forEach((h) => safe(() => h(name, p)))
}

/** Subscribe to one event. Returns an unsubscribe function. */
export function on<K extends FxEventName>(name: K, handler: Handler<K>): () => void {
  let set = handlers.get(name)
  if (!set) handlers.set(name, (set = new Set()))
  set.add(handler as Handler<never>)
  return () => {
    set.delete(handler as Handler<never>)
  }
}

/** Subscribe to every event (the Keeper's director and the score use this). */
export function onAny(handler: AnyHandler): () => void {
  anyHandlers.add(handler)
  return () => {
    anyHandlers.delete(handler)
  }
}
