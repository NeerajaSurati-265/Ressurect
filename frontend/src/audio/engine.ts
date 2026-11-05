import { getPrefs } from './prefs'

/**
 * The Web Audio graph. The AudioContext is created lazily, only from a user gesture (the toggle's
 * click or the first pointer/key press when sound was left on). Nothing here ever autoplays.
 *
 *   music bus ─┬──────────────► master (volume pref) ─► limiter ─► speakers
 *              └─ send ─► verb ─► convolver ─► return ─┘
 *   sfx bus   ─┬──────────────► master
 *              └─ send ─► verb
 */
export interface Engine {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  sfx: GainNode
  /** direct input to the reverb (for sends heavier than the bus sends) */
  verb: GainNode
}


/** Hard ceiling for the master gain (the limiter catches anything above this). */
export const MASTER_CAP = 1

/** Master gain for the volume pref: a gentle curve so the slider feels even (0.6 -> ~0.46). */
export function masterTarget(): number {
  const v = getPrefs().volume
  return Math.min(MASTER_CAP, Math.max(0, v) ** 1.5)
}

type Ctor = typeof AudioContext

function ctor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function audioSupported(): boolean {
  return ctor() !== null
}

let engine: Engine | null = null
let enabled = false

export function getEngine(): Engine | null {
  return engine
}

export function setEnabled(b: boolean) {
  enabled = b
}

export function isEnabled(): boolean {
  return enabled
}

/** True only when sound is on and the context is actually running. */
export function isLive(): boolean {
  return !!engine && enabled && engine.ctx.state === 'running'
}

let stateHook: ((state: string) => void) | null = null
/** Called on every AudioContext state change (the controller uses it to re-arm resume). */
export function onContextState(fn: (state: string) => void) {
  stateHook = fn
}

/** Decaying stereo noise, darkened over time: a cathedral-like tail of about 4.5 s. */
function impulse(ctx: AudioContext, seconds = 4.5): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const buf = ctx.createBuffer(2, len, sr)
  const pre = Math.floor(sr * 0.018)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let y = 0
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0
        continue
      }
      const t = (i - pre) / sr
      const k = t / seconds
      // RT60 ~ the full length; slight fade-to-zero so the tail ends cleanly
      const env = Math.exp((-6.9 * t) / seconds) * (1 - k) ** 0.5
      // one-pole low-pass whose cutoff falls over time (bright onset, dark tail)
      const a = 0.08 + 0.88 * Math.min(1, k * 1.4)
      y += (1 - a) * (Math.random() * 2 - 1 - y)
      d[i] = y * env * (1 + a * 2)
    }
  }
  return buf
}

/** Create the engine. Call only from a user gesture. Returns null if Web Audio fails. */
export function createEngine(): Engine | null {
  if (engine) return engine
  const C = ctor()
  if (!C) return null
  try {
    const ctx = new C()
    ctx.addEventListener?.('statechange', () => {
      try {
        stateHook?.(ctx.state)
      } catch {
        /* ignore */
      }
    })
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 8
    limiter.ratio.value = 6
    limiter.attack.value = 0.01
    limiter.release.value = 0.3
    limiter.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(limiter)

    const verb = ctx.createGain()
    const conv = ctx.createConvolver()
    try {
      conv.buffer = impulse(ctx)
    } catch {
      /* no reverb: the dry path still works */
    }
    const ret = ctx.createGain()
    ret.gain.value = 0.7
    verb.connect(conv).connect(ret).connect(master)

    const music = ctx.createGain()
    music.gain.value = 0.85
    music.connect(master)
    const musicSend = ctx.createGain()
    musicSend.gain.value = 0.4
    music.connect(musicSend).connect(verb)

    const sfx = ctx.createGain()
    sfx.gain.value = 0.85
    sfx.connect(master)
    const sfxSend = ctx.createGain()
    sfxSend.gain.value = 0.28
    sfx.connect(sfxSend).connect(verb)

    engine = { ctx, master, music, sfx, verb }
    console.info('[resurrect] audio context created:', ctx.state)
    return engine
  } catch (e) {
    console.warn('[resurrect] audio unavailable', e)
    engine = null
    return null
  }
}

/** Ramp the master gain to `to` over `seconds`, from wherever it is now. */
export function rampMaster(to: number, seconds: number) {
  if (!engine) return
  try {
    const g = engine.master.gain
    const now = engine.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(Math.min(MASTER_CAP, Math.max(0, to)), now + seconds)
  } catch {
    /* ignore */
  }
}

const noiseCache = new Map<string, AudioBuffer>()

/** Cached mono noise buffers (white, pink or brown). */
export function noiseBuffer(ctx: AudioContext, kind: 'white' | 'pink' | 'brown', seconds = 4): AudioBuffer {
  const key = `${kind}|${seconds}`
  const hit = noiseCache.get(key)
  if (hit) return hit
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (kind === 'white') d[i] = w
    else if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18
    } else {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    }
  }
  // short crossfade of the seam so looping never clicks
  const fade = Math.min(len >> 2, Math.floor(ctx.sampleRate * 0.05))
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k
  }
  noiseCache.set(key, buf)
  return buf
}

export const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)
export const rand = (a: number, b: number) => a + Math.random() * (b - a)
