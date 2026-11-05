import { getEngine, isLive, noiseBuffer, rand, type Engine } from './engine'

/**
 * Synthesised sound effects, all on the sfx bus. Every export is a safe no-op when sound is off
 * or the context does not exist, and none of them ever throws. Polyphony is capped; every node is
 * stopped and disconnected after use.
 */
const MAX_VOICES = 10
let voices = 0

interface Voice {
  ctx: AudioContext
  t: number
  out: GainNode
  e: Engine
  keep: (...n: AudioNode[]) => void
}

/** Build one short-lived voice; it is torn down after `dur` seconds. */
function play(dur: number, build: (v: Voice) => void, priority = false) {
  try {
    if (!isLive()) return
    const e = getEngine()
    if (!e) return
    if (voices >= MAX_VOICES && !priority) return
    const ctx = e.ctx
    const out = ctx.createGain()
    out.connect(e.sfx)
    const nodes: AudioNode[] = [out]
    voices++
    build({ ctx, t: ctx.currentTime + 0.01, out, e, keep: (...n) => nodes.push(...n) })
    window.setTimeout(() => {
      voices = Math.max(0, voices - 1)
      nodes.forEach((n) => {
        try {
          const src = n as Partial<AudioScheduledSourceNode>
          if (typeof src.stop === 'function') src.stop()
        } catch {
          /* already stopped */
        }
        try {
          n.disconnect()
        } catch {
          /* ignore */
        }
      })
    }, (dur + 0.4) * 1000)
  } catch {
    /* never throw from a sound effect */
  }
}

function noise(v: Voice, kind: 'white' | 'pink' | 'brown', dur: number): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource()
  const buf = noiseBuffer(v.ctx, kind, 4)
  src.buffer = buf
  src.loop = true
  src.start(v.t, rand(0, buf.duration - 0.1))
  src.stop(v.t + dur)
  v.keep(src)
  return src
}

function filter(v: Voice, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = v.ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  v.keep(f)
  return f
}

function gain(v: Voice, value = 0): GainNode {
  const g = v.ctx.createGain()
  g.gain.value = value
  v.keep(g)
  return g
}

/** ritual-start: a slab of stone grinding aside (~1.5 s). */
export function playGrind() {
  play(1.7, (v) => {
    const src = noise(v, 'brown', 1.7)
    const lp = filter(v, 'lowpass', 520, 1.2)
    const bp = filter(v, 'bandpass', 180, 0.9)
    const am = gain(v)
    const g = am.gain
    g.setValueAtTime(0, v.t)
    // jittery amplitude: rough stone catching and slipping
    for (let s = 0.03; s < 1.55; s += 0.035) {
      const env = Math.sin(Math.PI * Math.min(1, s / 1.55)) ** 0.7
      g.linearRampToValueAtTime(env * rand(0.25, 1) * 0.55, v.t + s)
    }
    g.linearRampToValueAtTime(0, v.t + 1.65)
    lp.frequency.setValueAtTime(380, v.t)
    lp.frequency.linearRampToValueAtTime(700, v.t + 0.8)
    lp.frequency.linearRampToValueAtTime(300, v.t + 1.6)
    src.connect(lp)
    lp.connect(am)
    src.connect(bp).connect(am)
    am.connect(v.out)
  }, true)
}

/** alive: a crack, then a shimmer gliding up through the reverb. */
export function playRise() {
  play(0.4, (v) => {
    const src = noise(v, 'white', 0.3)
    const hp = filter(v, 'highpass', 1400)
    const g = gain(v)
    g.gain.setValueAtTime(0, v.t)
    g.gain.linearRampToValueAtTime(0.32, v.t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0008, v.t + 0.16)
    src.connect(hp).connect(g).connect(v.out)
    // a low body under the crack
    const o = v.ctx.createOscillator()
    o.frequency.setValueAtTime(110, v.t)
    o.frequency.exponentialRampToValueAtTime(45, v.t + 0.2)
    const og = gain(v)
    og.gain.setValueAtTime(0.22, v.t)
    og.gain.exponentialRampToValueAtTime(0.0008, v.t + 0.25)
    o.connect(og).connect(v.out)
    o.start(v.t)
    o.stop(v.t + 0.3)
    v.keep(o)
  }, true)
  play(4.2, (v) => {
    const t = v.t + 0.12
    const wet = gain(v, 0.6)
    v.out.gain.value = 0.35
    v.out.connect(wet).connect(v.e.verb)
    ;[1, 1.5, 2, 3].forEach((r, i) => {
      const o = v.ctx.createOscillator()
      const f = 587.33 * r // D5 upward
      o.frequency.setValueAtTime(f, t)
      o.frequency.exponentialRampToValueAtTime(f * 2, t + 2.6)
      o.detune.value = rand(-9, 9)
      const g = gain(v)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.06 / (i + 1), t + 0.7 + i * 0.15)
      g.gain.exponentialRampToValueAtTime(0.0005, t + 3.8)
      o.connect(g).connect(v.out)
      o.start(t)
      o.stop(t + 4)
      v.keep(o)
    })
  }, true)
}

/** failed: a breathy ghostly wail. */
export function playWail() {
  play(3.2, (v) => {
    const t = v.t
    const src = noise(v, 'pink', 3)
    const f1 = filter(v, 'bandpass', 520, 9)
    const f2 = filter(v, 'bandpass', 900, 11)
    const path = [520, 880, 760, 430]
    const path2 = [900, 1250, 1100, 700]
    f1.frequency.setValueAtTime(path[0], t)
    f2.frequency.setValueAtTime(path2[0], t)
    ;[0.8, 1.7, 2.9].forEach((s, i) => {
      f1.frequency.linearRampToValueAtTime(path[i + 1], t + s)
      f2.frequency.linearRampToValueAtTime(path2[i + 1], t + s)
    })
    const g = gain(v)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.7)
    g.gain.linearRampToValueAtTime(0.35, t + 2)
    g.gain.linearRampToValueAtTime(0, t + 3)
    src.connect(f1).connect(g)
    src.connect(f2).connect(g)
    g.connect(v.out)
    // quiet sine glide down, with a slow vibrato
    const o = v.ctx.createOscillator()
    o.frequency.setValueAtTime(660, t)
    o.frequency.exponentialRampToValueAtTime(300, t + 2.9)
    const vib = v.ctx.createOscillator()
    vib.frequency.value = 5
    const vibDepth = gain(v, 7)
    vib.connect(vibDepth).connect(o.frequency)
    const og = gain(v)
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(0.035, t + 0.6)
    og.gain.linearRampToValueAtTime(0, t + 3)
    o.connect(og).connect(v.out)
    o.start(t)
    vib.start(t)
    o.stop(t + 3.1)
    vib.stop(t + 3.1)
    v.keep(o, vib)
  }, true)
}

let lastQuill = 0
/** log-lines: a quiet quill scratch, at most one per 400 ms. */
export function playQuill() {
  const now = performance.now()
  if (now - lastQuill < 400) return
  lastQuill = now
  play(0.25, (v) => {
    const src = noise(v, 'white', 0.22)
    const hp = filter(v, 'highpass', 2600)
    const bp = filter(v, 'bandpass', rand(3800, 6000), 2.2)
    const g = gain(v)
    g.gain.setValueAtTime(0, v.t)
    let s = 0
    const strokes = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < strokes; i++) {
      const len = rand(0.03, 0.06)
      g.gain.linearRampToValueAtTime(rand(0.05, 0.08), v.t + s + 0.006)
      g.gain.linearRampToValueAtTime(0, v.t + s + len)
      s += len + rand(0.01, 0.03)
    }
    bp.frequency.setValueAtTime(bp.frequency.value, v.t)
    bp.frequency.linearRampToValueAtTime(bp.frequency.value * 0.75, v.t + s)
    src.connect(hp).connect(bp).connect(g).connect(v.out)
  })
}

/** A soft filtered-noise sweep (the Keeper's glide). */
export function playWhoosh(): void {
  play(0.9, (v) => {
    const src = noise(v, 'pink', 0.85)
    const bp = filter(v, 'bandpass', 300, 1.6)
    bp.frequency.setValueAtTime(260, v.t)
    bp.frequency.exponentialRampToValueAtTime(1600, v.t + 0.4)
    bp.frequency.exponentialRampToValueAtTime(500, v.t + 0.8)
    const g = gain(v)
    g.gain.setValueAtTime(0, v.t)
    g.gain.linearRampToValueAtTime(0.12, v.t + 0.35)
    g.gain.linearRampToValueAtTime(0, v.t + 0.82)
    src.connect(bp).connect(g).connect(v.out)
  })
}

let lastTick = 0
/** A very quiet typewriter tick (typed speech). */
export function playTick(): void {
  const now = performance.now()
  if (now - lastTick < 35) return
  lastTick = now
  play(0.05, (v) => {
    const src = noise(v, 'white', 0.02)
    const bp = filter(v, 'bandpass', rand(2200, 3200), 3)
    const g = gain(v)
    g.gain.setValueAtTime(0, v.t)
    g.gain.linearRampToValueAtTime(0.045, v.t + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0005, v.t + 0.018)
    src.connect(bp).connect(g).connect(v.out)
  })
}

/** Sound switched on: one soft, short bell chime (~2.5 s) as confirmation. */
export function playChime(): void {
  play(
    2.8,
    (v) => {
      const f0 = 880
      const ratios = [1, 2.01, 2.76, 4.07, 5.43]
      const out = gain(v, 1)
      out.connect(v.out)
      const send = gain(v, 0.35)
      out.connect(send)
      send.connect(v.e.verb)
      ratios.forEach((r, i) => {
        const o = v.ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f0 * r
        const g = gain(v, 0)
        const amp = 0.16 / (i + 1)
        const dur = Math.min(2.5, 2.5 / Math.sqrt(r))
        g.gain.setValueAtTime(0, v.t)
        g.gain.linearRampToValueAtTime(amp, v.t + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, v.t + dur)
        o.connect(g)
        g.connect(out)
        o.start(v.t)
        o.stop(v.t + dur + 0.05)
        v.keep(o)
      })
    },
    true,
  )
}
