import { onAny } from '../fx/events'
import { hasAsset } from '../lib/asset'
import { audioSupported, createEngine, getEngine, isEnabled, masterTarget, onContextState, rampMaster, setEnabled } from './engine'
import { getPrefs, setSoundOn, subscribePrefs } from './prefs'
import { createScore, type Score } from './score'
import { playChime, playGrind, playQuill, playRise, playWail } from './sfx'

/**
 * Wires prefs, the engine, the score (or the optional theme file) and the event bus together.
 * Audio starts only from `startAudio()`, which callers invoke inside a user gesture.
 */
export type SoundStatus = 'unsupported' | 'off' | 'waiting' | 'on'

const THEME_URL = `${import.meta.env.BASE_URL}audio/theme.mp3`

let score: Score | null = null
let theme: HTMLAudioElement | null = null
let themeChecked: Promise<boolean> | null = null
let themeOk: boolean | null = null
let suspendTimer = 0
/** While true the music runs silently (the gate's promo is playing); releaseMusic() lifts it. */
let held = false
let loggedState = false
const statusListeners = new Set<() => void>()

function notify() {
  statusListeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

export function getStatus(): SoundStatus {
  if (!audioSupported()) return 'unsupported'
  if (!getPrefs().soundOn) return 'off'
  return isEnabled() ? 'on' : 'waiting'
}

export function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn)
  const unPrefs = subscribePrefs(fn)
  return () => {
    statusListeners.delete(fn)
    unPrefs()
  }
}

/** Look for the optional licensed track (HEAD only; safe before any gesture). */
export function checkTheme(): Promise<boolean> {
  if (!themeChecked) {
    themeChecked = hasAsset(THEME_URL, 'audio/')
      .then((ok) => (themeOk = ok))
      .catch(() => (themeOk = false))
  }
  return themeChecked
}

function startScore() {
  const e = getEngine()
  if (!e || score) return
  try {
    score = createScore(e)
    applyMood(lastMood)
  } catch (err) {
    console.warn('[resurrect] score failed', err)
    score = null
  }
}

function startTheme(): boolean {
  const e = getEngine()
  if (!e) return false
  try {
    if (!theme) {
      const el = new Audio(THEME_URL)
      el.loop = true
      el.preload = 'auto'
      const src = e.ctx.createMediaElementSource(el)
      const g = e.ctx.createGain()
      g.gain.value = 0.8
      src.connect(g).connect(e.music)
      theme = el
    }
    const p = theme.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // blocked or undecodable: fall back to the generated score
        theme = null
        themeOk = false
        startScore()
      })
    }
    return true
  } catch {
    theme = null
    return false
  }
}

function startMusic() {
  if (score || theme) {
    if (theme && theme.paused) void theme.play().catch(() => {})
    return
  }
  if (themeOk === true) {
    if (!startTheme()) startScore()
  } else if (themeOk === false) {
    startScore()
  } else {
    void checkTheme().then((ok) => {
      if (!isEnabled() || score || theme) return
      if (!(ok && startTheme())) startScore()
    })
  }
}

export interface StartOptions {
  /** keep the master silent until releaseMusic() (the context still starts inside the gesture) */
  hold?: boolean
  /** play the soft confirmation chime once the context runs */
  chime?: boolean
}

/**
 * Start (or resume) audio. Call only from a user gesture: the context is created and
 * `ctx.resume()` is called synchronously, inside the handler. Never throws.
 */
export function startAudio(opts: StartOptions = {}): Promise<boolean> {
  try {
    const e = createEngine()
    if (!e) return Promise.resolve(false)
    // resume first, synchronously in the gesture, before anything else can await
    const resumed = e.ctx.resume()
    window.clearTimeout(suspendTimer)
    setEnabled(true)
    held = !!opts.hold
    rampMaster(held ? 0 : masterTarget(), held ? 0.05 : 1.5)
    startMusic()
    notify()
    return resumed
      .then(() => {
        const running = e.ctx.state === 'running'
        if (!loggedState) {
          loggedState = true
          console.info('[resurrect] audio context after gesture:', e.ctx.state)
        }
        if (!running) armRetry()
        else if (opts.chime && !held) playChime()
        return running
      })
      .catch(() => {
        armRetry()
        return false
      })
  } catch {
    return Promise.resolve(false)
  }
}

// Some browsers (touch) only grant activation on pointerup/touchend: retry resume on the next gesture.
const RETRY = ['pointerup', 'touchend', 'keydown', 'click'] as const
let retryArmed = false
function armRetry() {
  if (retryArmed) return
  retryArmed = true
  const handler = () => {
    const e = getEngine()
    if (!e || !isEnabled()) return disarm()
    if (theme && theme.paused) void theme.play().catch(() => {})
    void e.ctx
      .resume()
      .then(() => {
        if (e.ctx.state === 'running') disarm()
      })
      .catch(() => {})
  }
  const disarm = () => {
    retryArmed = false
    RETRY.forEach((g) => window.removeEventListener(g, handler, true))
  }
  RETRY.forEach((g) => window.addEventListener(g, handler, { capture: true, passive: true }))
}

/** Fade the (held) music in over `seconds`. Safe to call when sound is off: it does nothing. */
export function releaseMusic(seconds = 1.4) {
  held = false
  if (!isEnabled()) return
  rampMaster(masterTarget(), seconds)
}

/** Fade out over ~0.6 s, then suspend. */
export function stopAudio() {
  try {
    const was = isEnabled()
    setEnabled(false)
    if (was) notify()
    const e = getEngine()
    if (!e) return
    rampMaster(0, 0.6)
    window.clearTimeout(suspendTimer)
    suspendTimer = window.setTimeout(() => {
      if (isEnabled()) return
      theme?.pause()
      void e.ctx.suspend().catch(() => {})
    }, 700)
  } catch {
    /* ignore */
  }
}

export function turnOn() {
  setSoundOn(true)
  return startAudio({ chime: true })
}

export function turnOff() {
  setSoundOn(false)
  stopAudio()
}

// If anything else turns the preference off, follow it. Follow the volume slider too.
let lastVolume = getPrefs().volume
subscribePrefs((p) => {
  if (!p.soundOn && isEnabled()) stopAudio()
  if (p.volume !== lastVolume) {
    lastVolume = p.volume
    if (isEnabled() && !held) rampMaster(masterTarget(), 0.15)
  }
})

// The context can be suspended or "interrupted" (iOS) behind our back: re-arm a resume on the
// next gesture whenever sound is on, the tab is visible and the context is not running.
onContextState((state) => {
  if (state !== 'running' && isEnabled() && document.visibilityState === 'visible') armRetry()
})

// Hidden tab: suspend. Back: resume if sound is on.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const e = getEngine()
    if (!e) return
    try {
      if (document.visibilityState === 'hidden') {
        theme?.pause()
        void e.ctx.suspend().catch(() => {})
      } else if (isEnabled()) {
        // a pending stop must not suspend us again after we come back
        window.clearTimeout(suspendTimer)
        if (!held) rampMaster(masterTarget(), 0.4)
        void e.ctx
          .resume()
          .then(() => {
            if (e.ctx.state !== 'running') armRetry()
          })
          .catch(() => armRetry())
        if (theme) void theme.play().catch(() => {})
      }
    } catch {
      /* ignore */
    }
  })
}

// ---- adaptive score + sfx from the event bus --------------------------------------------------
type Mood = 'base' | 'ritual' | 'bare'
let lastMood: Mood = 'base'
let beating = false

function applyMood(m: Mood) {
  lastMood = m
  score?.setMood(m)
  score?.heartbeat(beating)
}

function setBeat(on: boolean) {
  beating = on
  score?.heartbeat(on)
}

onAny((name) => {
  switch (name) {
    case 'ritual-start':
      applyMood('ritual')
      playGrind()
      break
    case 'phase-change':
      applyMood('ritual')
      break
    case 'log-lines':
      playQuill()
      break
    case 'pulse-attempt':
      applyMood('ritual')
      setBeat(true)
      break
    case 'alive':
      setBeat(false)
      applyMood('base')
      score?.resolveBright()
      playRise()
      break
    case 'failed':
      setBeat(false)
      applyMood('base')
      score?.dissonantSwell()
      playWail()
      break
    case 'cannot-rise':
      setBeat(false)
      applyMood('base')
      score?.dissonantSwell()
      break
    case 'expired':
    case 'turned-away':
      setBeat(false)
      applyMood('bare')
      break
    case 'landing':
    case 'lost':
      setBeat(false)
      applyMood('base')
      break
    default:
      break
  }
})
