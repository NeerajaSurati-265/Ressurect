import type { ErrorCode } from '@contracts/types'
import { onAny, type FxEventName, type FxEvents, type RitualPhase } from '../fx/events'
import { gate } from '../gate/gateState'
import { getKeeper, setKeeper } from './store'

/**
 * The Keeper's script and its director. The director listens to the fx bus once and feeds a
 * FIFO queue of lines to the speech scroll, one at a time. Speech is decoration (aria-hidden);
 * the routes' aria-live regions stay the accessible channel.
 */

// ---------------------------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------------------------

/** Every line the Keeper can say, keyed by cue. A cue's variants are picked without repeats. */
export const SCRIPT = {
  landing: ['Another soul seeks to raise the forgotten...', 'Bring me a grave, and I shall try.'],
  keystroke: ['Yes... I can feel it stirring.', 'Go on. The earth is listening.'],
  'ritual-start': ['Let us begin.', 'Stand back. The earth remembers.'],
  'phase:cloning': ['I dig into the earth...', 'The spade finds the old bones...'],
  'phase:installing': ['Gathering the ingredients of its making...', 'Fetching every herb it needs to live...'],
  'phase:building': ['Stitching the bones together...', 'Bone to bone, the shape returns...'],
  'phase:uploading': ['Carrying it up to the surface...', 'Up, toward the moonlight...'],
  pulse: ['Quiet now... I hear a heartbeat.', 'Is it... breathing?'],
  'alive:1': ['It lives!', 'It breathes!'],
  'alive:2': ['Go on. The world may look upon it now.', 'Go on. Show the world what you raised.'],
  'failed:1': ['Something holds it in the grave.'],
  'failed:silent': ['The spirits are silent. Read its last words below.'],
  'failed:command': ['The incantation is written there.'],
  'cannot-rise': ['This one cannot rise... not yet.', 'These bones are not ready to rise.'],
  'turned:rate_limited': ['The gate is closed to you this hour.', 'Too many rituals. Wait for the next bell.'],
  'turned:quota_exhausted': ['No more rituals tonight.', 'The graveyard has given all it can tonight.'],
  'turned:resurrections_disabled': ['The graveyard sleeps.', 'The gates are locked. No rituals now.'],
  'turned:repo_not_found': ['There is no grave by that name.', 'I searched, but no stone bears that name.'],
  'turned:invalid_url': ['Those words point to no grave I know.', 'That is not a grave I can read.'],
  'turned:repo_too_large': ['This one is too heavy to raise.', 'The coffin is too large for my spade.'],
  'turned:other': ['The ritual was turned away.', 'Something bars the way tonight.'],
  expired: ['The spell wears off at dawn.', 'Rest now.'],
  lost: ['You have wandered far. Come back to the light.', 'This path leads nowhere. Follow the lantern home.'],
  idle: ['The fog is thick tonight.', 'The crows are restless.', 'Even the dead grow tired of waiting.'],
} satisfies Record<string, string[]>

export type Cue = keyof typeof SCRIPT

const lastPick = new Map<Cue, number>()

/** A random variant of `cue`, never the same one twice in a row. */
export function pick(cue: Cue): string {
  const list: readonly string[] = SCRIPT[cue]
  if (list.length === 1) return list[0]
  const prev = lastPick.get(cue) ?? -1
  let i = Math.floor(Math.random() * list.length)
  if (i === prev) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length
  lastPick.set(cue, i)
  return list[i]
}

/**
 * Trims long ghost/autopsy text to one sentence for speech: up to the first sentence end,
 * otherwise cut at a word boundary with an ellipsis. Never longer than `max` characters.
 */
export function oneSentence(text: string, max = 110): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  // a sentence ends at . ! ? or … followed by a capitalised word or the end (not "e.g." or "v1.2")
  const m = /^(.+?[.!?…])(?=\s+["'([]?[A-Z]|\s*$)/.exec(t)
  const first = m ? m[1] : t
  if (first.length <= max) return first
  const room = first.slice(0, max - 1)
  const cut = room.lastIndexOf(' ')
  const head = (cut > max * 0.5 ? room.slice(0, cut) : room).replace(/[\s,;:.\-–—]+$/, '')
  return `${head}…`
}

// ---------------------------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------------------------

export interface SpeechLine {
  id: number
  text: string
}

interface Queued extends SpeechLine {
  /** runs when the line starts playing (e.g. tilt the lantern toward the command box) */
  onStart?: () => void
}

type SpeechListener = (line: SpeechLine | null) => void

const QUEUE_CAP = 4
const GAP_MS = 420
const LANDING_DELAY_MS = 4000
const IDLE_AFTER_MS = 40000
const IDLE_EVERY_MS = 180000

let nextId = 1
let current: Queued | null = null
let queue: Queued[] = []
let gapTimer = 0
const speechListeners = new Set<SpeechListener>()

function publish() {
  const l = current ? { id: current.id, text: current.text } : null
  speechListeners.forEach((fn) => {
    try {
      fn(l)
    } catch (e) {
      console.warn('[resurrect] speech listener failed', e)
    }
  })
}

function advance() {
  window.clearTimeout(gapTimer)
  gapTimer = 0
  current = queue.shift() ?? null
  if (current?.onStart) {
    try {
      current.onStart()
    } catch {
      /* staging is decoration */
    }
  }
  publish()
}

/** The scroll subscribes here; it is called at once with the current line (or null). */
export function subscribeSpeech(fn: SpeechListener): () => void {
  speechListeners.add(fn)
  fn(current ? { id: current.id, text: current.text } : null)
  return () => {
    speechListeners.delete(fn)
  }
}

/** The scroll reports that line `id` has finished (typed, held and faded). */
export function speechDone(id: number) {
  if (!current || current.id !== id) return
  current = null
  publish()
  window.clearTimeout(gapTimer)
  gapTimer = window.setTimeout(advance, GAP_MS)
}

/** True while a line is playing or waiting. */
export function isSpeaking() {
  return !!current || queue.length > 0
}

/**
 * Queues lines. `scene: true` starts a new scene: pending lines from the old one are dropped
 * and the line being shown is cut short.
 */
export function say(lines: Array<string | { text: string; onStart?: () => void }>, opts: { scene?: boolean } = {}) {
  if (opts.scene) {
    queue = []
    if (current) {
      current = null
      publish()
    }
  }
  for (const raw of lines) {
    const item = typeof raw === 'string' ? { text: raw } : raw
    const text = item.text.trim()
    if (!text) continue
    if (current?.text === text || queue.some((q) => q.text === text)) continue
    queue.push({ id: nextId++, text, onStart: item.onStart })
  }
  while (queue.length > QUEUE_CAP) queue.shift()
  if (!current && !gapTimer && queue.length) {
    // a cut-short line gets a beat of silence; otherwise start at once
    if (opts.scene) gapTimer = window.setTimeout(advance, 240)
    else advance()
  }
}

// ---- scene state ----
let sceneSeq = 0
let onLanding = false
let typedThisVisit = false
let pulseSaid = false
let landingTimer = 0

function newScene() {
  sceneSeq++
  onLanding = false
  pulseSaid = false
  window.clearTimeout(landingTimer)
}

const PHASE_CUE: Partial<Record<RitualPhase, Cue>> = {
  cloning: 'phase:cloning',
  installing: 'phase:installing',
  building: 'phase:building',
  uploading: 'phase:uploading',
}

function turnedAwayCue(code: ErrorCode): Cue {
  const cue = `turned:${code}` as Cue
  return cue in SCRIPT ? cue : 'turned:other'
}

function handle<K extends FxEventName>(name: K, payload: FxEvents[K]) {
  switch (name) {
    case 'landing': {
      newScene()
      onLanding = true
      typedThisVisit = false
      say([], { scene: true })
      const seq = sceneSeq
      const path = window.location.pathname
      landingTimer = window.setTimeout(() => {
        if (seq !== sceneSeq || !onLanding || window.location.pathname !== path) return
        if (typedThisVisit) return // they are already at work; no need to beckon
        if (gate.isActive()) return // the gate greets them itself, after its reveal
        say([pick('landing')])
      }, LANDING_DELAY_MS)
      return
    }
    case 'keystroke':
      if (!onLanding || typedThisVisit) return
      typedThisVisit = true
      say([pick('keystroke')])
      return
    case 'ritual-start':
      newScene()
      say([pick('ritual-start')], { scene: true })
      return
    case 'phase-change': {
      const cue = PHASE_CUE[(payload as FxEvents['phase-change']).phase]
      if (cue) say([pick(cue)])
      return
    }
    case 'pulse-attempt':
      if (pulseSaid) return
      pulseSaid = true
      say([pick('pulse')])
      return
    case 'alive':
      newScene()
      say([pick('alive:1'), pick('alive:2')], { scene: true })
      return
    case 'failed': {
      newScene()
      const f = payload as FxEvents['failed']
      const lines: Parameters<typeof say>[0] = [pick('failed:1')]
      if (f.source === 'fallback') {
        lines.push(pick('failed:silent'))
      } else {
        // keep each composed line within ~110 characters
        if (f.cause) lines.push(`The spirit says: ${oneSentence(f.cause, 92)}`)
        if (f.fix) lines.push(`Do this, and try again: ${oneSentence(f.fix, 86)}`)
      }
      if (f.command) {
        lines.push({
          text: pick('failed:command'),
          onStart: () => setKeeper({ ...getKeeper(), focus: 'command' }),
        })
      }
      say(lines, { scene: true })
      return
    }
    case 'cannot-rise': {
      newScene()
      const summary = oneSentence((payload as FxEvents['cannot-rise']).summary ?? '', 110)
      say([pick('cannot-rise'), summary], { scene: true })
      return
    }
    case 'turned-away':
      newScene()
      say([pick(turnedAwayCue((payload as FxEvents['turned-away']).code))], { scene: true })
      return
    case 'expired':
      newScene()
      say([pick('expired')], { scene: true })
      return
    case 'lost':
      newScene()
      say([pick('lost')], { scene: true })
      return
    default:
      return
  }
}

/** The entry gate's reveal is over: the Keeper speaks its first line from where the light came. */
export function greet() {
  if (!onLanding || typedThisVisit || window.location.pathname !== '/') return
  window.clearTimeout(landingTimer)
  bump()
  say([SCRIPT.landing[0]])
}

// ---- idle ambience ----
let lastActivity = 0
let lastIdleLine = -Infinity

function bump() {
  lastActivity = performance.now()
}

function idleCheck() {
  if (document.hidden || gate.isActive()) return
  const now = performance.now()
  if (now - lastActivity < IDLE_AFTER_MS || now - lastIdleLine < IDLE_EVERY_MS || isSpeaking()) return
  lastIdleLine = now
  lastActivity = now
  say([pick('idle')])
}

let started = false

/** Subscribes the director to the bus and to user input. Idempotent; runs for the app's lifetime. */
export function startDirector() {
  if (started || typeof window === 'undefined') return
  started = true
  lastActivity = performance.now()
  onAny((name, payload) => {
    bump()
    handle(name, payload)
  })
  let lastMove = 0
  const onMove = () => {
    const n = performance.now()
    if (n - lastMove > 500) {
      lastMove = n
      bump()
    }
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', bump, { passive: true })
  window.addEventListener('keydown', bump)
  window.addEventListener('scroll', bump, { passive: true })
  window.addEventListener('wheel', bump, { passive: true })
  window.setInterval(idleCheck, 5000)
}
