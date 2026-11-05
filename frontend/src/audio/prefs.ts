import { useSyncExternalStore } from 'react'

/**
 * Sound preferences. soundOn/voiceOn default to false, volume to 0.6; and persist in localStorage. Every storage access is
 * wrapped, so private windows or blocked storage just fall back to the defaults.
 * The Keeper reads `soundOn && voiceOn` to gate speech synthesis.
 */
export interface SoundPrefs {
  soundOn: boolean
  voiceOn: boolean
  /** music + sfx volume, 0..1 (default 0.6) */
  volume: number
}

const KEY_SOUND = 'resurrect:sound'
const KEY_VOICE = 'resurrect:voice'
const KEY_VOLUME = 'resurrect:volume'
export const DEFAULT_VOLUME = 0.6

function readVolume(): number {
  try {
    const raw = window.localStorage.getItem(KEY_VOLUME)
    if (raw === null) return DEFAULT_VOLUME
    const v = Number(raw)
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function write(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
}

let prefs: SoundPrefs = { soundOn: read(KEY_SOUND), voiceOn: read(KEY_VOICE), volume: readVolume() }
const listeners = new Set<(p: SoundPrefs) => void>()

function update(next: SoundPrefs) {
  if (next.soundOn === prefs.soundOn && next.voiceOn === prefs.voiceOn && next.volume === prefs.volume) return
  prefs = next
  listeners.forEach((fn) => {
    try {
      fn(prefs)
    } catch (e) {
      console.warn('[resurrect] prefs listener failed', e)
    }
  })
}

export function getPrefs(): SoundPrefs {
  return prefs
}

export function setSoundOn(b: boolean): void {
  write(KEY_SOUND, b)
  update({ ...prefs, soundOn: b })
}

export function setVoiceOn(b: boolean): void {
  write(KEY_VOICE, b)
  update({ ...prefs, voiceOn: b })
}

export function setVolume(v: number): void {
  const vol = Math.min(1, Math.max(0, Number.isFinite(v) ? v : DEFAULT_VOLUME))
  try {
    window.localStorage.setItem(KEY_VOLUME, vol.toFixed(2))
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  update({ ...prefs, volume: vol })
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function subscribePrefs(fn: (p: SoundPrefs) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const serverPrefs: SoundPrefs = { soundOn: false, voiceOn: false, volume: DEFAULT_VOLUME }

export function usePrefs(): SoundPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, () => serverPrefs)
}
