import { midi, noiseBuffer, rand, type Engine } from './engine'

/**
 * The generated ambient score. Every layer drifts on its own random walk with random periods, so
 * nothing repeats on a fixed loop. Everything here feeds the music bus (and a few direct reverb sends).
 *
 *   drone   D3/A3 detuned oscillators (laptop-audible, harmonics through ~1.2 kHz), a quiet D2 sub
 *           as an extra only; slowly beating, detune random-walking
 *   wind    bandpassed noise, gain and centre swelling on a random walk
 *   pad     detuned saws through a slow LFO low-pass, D minor voicings every 12-20 s, fundamentals
 *           kept in ~110-330 Hz so small speakers can play them
 *   bell    a distant inharmonic bell every 30-60 s, mostly reverb
 */
export type Mood = 'base' | 'ritual' | 'bare'

// D minor voicings (5 voices; the 5th only sounds while thickened)
// fundamentals live in MIDI 45-64 (110-330 Hz); the 5th voice may sit just above
const CHORDS: number[][] = [
  [50, 53, 57, 62, 65], // Dm
  [46, 53, 58, 62, 65], // Bb
  [50, 55, 58, 62, 67], // Gm
  [45, 52, 57, 60, 64], // Am
  [48, 53, 57, 60, 65], // F
  [50, 57, 60, 64, 65], // Dm9
  [46, 50, 55, 58, 62], // Gm/Bb colour
]
const BRIGHT = [50, 54, 57, 64, 62] // D major, added 9th
const BELL_RATIOS = [0.5, 1, 1.19, 1.5, 2, 2.74, 3.76, 5.43]

const ENDERS = 2.2

// filter cutoffs (base / ritual) and the pad's resting level
const DRONE_LP = 1200
const DRONE_LP_RITUAL = 1500
const PAD_LP = 1600
const PAD_LP_RITUAL = 2200
const PAD_LEVEL = 0.45 // seconds of release when nodes are torn down

export interface Score {
  setMood(m: Mood): void
  heartbeat(on: boolean): void
  resolveBright(): void
  dissonantSwell(): void
  stop(): void
}

export function createScore(e: Engine): Score {
  const { ctx } = e
  const timers = new Set<number>()
  const live = () => ctx.state === 'running'
  let stopped = false
  let mood: Mood = 'base'
  let brightUntil = 0
  let chordIdx = 0

  /** Run `fn` again and again, every minMs-maxMs (re-randomised each time). Skips while suspended. */
  const every = (minMs: number, maxMs: number, fn: () => void) => {
    const tick = () => {
      if (stopped) return
      if (live()) {
        try {
          fn()
        } catch {
          /* never let a layer kill the loop */
        }
      }
      const id = window.setTimeout(() => {
        timers.delete(id)
        tick()
      }, rand(minMs, maxMs))
      timers.add(id)
    }
    const id = window.setTimeout(() => {
      timers.delete(id)
      tick()
    }, rand(minMs, maxMs) * 0.3)
    timers.add(id)
  }
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      if (!stopped) {
        try {
          fn()
        } catch {
          /* ignore */
        }
      }
    }, ms)
    timers.add(id)
  }
  const glide = (p: AudioParam, v: number, tc: number) => {
    const now = ctx.currentTime
    p.cancelScheduledValues(now)
    p.setTargetAtTime(v, now, tc)
  }

  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(e.music)
  out.gain.setTargetAtTime(1, ctx.currentTime, 1.2)
  const sources: AudioScheduledSourceNode[] = []
  const start = <T extends AudioScheduledSourceNode>(n: T) => {
    n.start()
    sources.push(n)
    return n
  }

  // ---- drone --------------------------------------------------------------------------------
  const droneGain = ctx.createGain()
  droneGain.gain.value = 0.9
  const droneLp = ctx.createBiquadFilter()
  droneLp.type = 'lowpass'
  droneLp.frequency.value = DRONE_LP
  droneLp.Q.value = 0.5
  droneLp.connect(droneGain).connect(out)

  const droneVoices: { osc: OscillatorNode; base: number }[] = []
  const addDrone = (type: OscillatorType, note: number, level: number, detune: number) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = midi(note)
    o.detune.value = detune
    const g = ctx.createGain()
    g.gain.value = level
    o.connect(g).connect(droneLp)
    start(o)
    droneVoices.push({ osc: o, base: detune })
    return g
  }
  addDrone('triangle', 50, 0.22, 4) // D3 (147 Hz): the audible fundamental
  addDrone('sawtooth', 50, 0.06, -5) // D3, beats against the triangle and adds harmonics
  addDrone('sine', 57, 0.12, 0) // A3 (220 Hz)
  addDrone('sine', 38, 0.06, 0) // D2 sub: extra weight on big speakers only
  const fifth = addDrone('sine', 62, 0, 2) // D4, the extra ritual voice
  fifth.gain.value = 0

  every(3000, 7000, () => {
    for (const v of droneVoices) glide(v.osc.detune, v.base + rand(-9, 9), rand(2, 5))
  })

  // ---- wind ---------------------------------------------------------------------------------
  const wind = ctx.createBufferSource()
  wind.buffer = noiseBuffer(ctx, 'pink', 9)
  wind.loop = true
  const windBp = ctx.createBiquadFilter()
  windBp.type = 'bandpass'
  windBp.frequency.value = 500
  windBp.Q.value = 1.1
  const windGain = ctx.createGain()
  windGain.gain.value = 0.04
  wind.connect(windBp).connect(windGain).connect(out)
  start(wind)
  every(2500, 6500, () => {
    const cap = mood === 'bare' ? 0.015 : 0.1
    glide(windGain.gain, rand(0.01, cap), rand(1.5, 3.5))
    glide(windBp.frequency, rand(280, 1300), rand(2, 4))
    glide(wind.playbackRate, rand(0.85, 1.15), 4)
  })

  // ---- pad ----------------------------------------------------------------------------------
  const padLp = ctx.createBiquadFilter()
  padLp.type = 'lowpass'
  padLp.frequency.value = PAD_LP
  padLp.Q.value = 0.8
  const padFormant = ctx.createBiquadFilter() // a soft "ah" bump: choir-ish
  padFormant.type = 'peaking'
  padFormant.frequency.value = 900
  padFormant.Q.value = 1.4
  padFormant.gain.value = 5
  const padGain = ctx.createGain()
  padGain.gain.value = PAD_LEVEL
  padLp.connect(padFormant).connect(padGain).connect(out)
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.035
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 500
  lfo.connect(lfoDepth).connect(padLp.frequency)
  start(lfo)

  const padVoices = CHORDS[0].map((note, i) => {
    const g = ctx.createGain()
    g.gain.value = i < 4 ? 0.13 : 0
    g.connect(padLp)
    const oscs = [-7, 6].map((cents) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = midi(note)
      o.detune.value = cents + rand(-3, 3)
      o.connect(g)
      start(o)
      return o
    })
    return { g, oscs }
  })

  const voice = (notes: number[], tc: number) => {
    padVoices.forEach((v, i) => v.oscs.forEach((o) => glide(o.frequency, midi(notes[i]), tc)))
  }
  every(12000, 20000, () => {
    if (ctx.currentTime < brightUntil) return
    let next = chordIdx
    while (next === chordIdx) next = Math.floor(Math.random() * CHORDS.length)
    chordIdx = next
    voice(CHORDS[chordIdx], rand(1.2, 2.4))
    padVoices.forEach((v) => v.oscs.forEach((o) => glide(o.detune, (o.detune.value > 0 ? 6 : -7) + rand(-4, 4), 3)))
  })
  every(5000, 11000, () => {
    if (mood === 'bare' || ctx.currentTime < brightUntil) return
    glide(padGain.gain, rand(0.34, mood === 'ritual' ? 0.58 : 0.5), rand(3, 6))
  })

  // ---- bell ---------------------------------------------------------------------------------
  const bell = () => {
    if (mood === 'bare') return
    const t = ctx.currentTime + 0.05
    const f0 = midi([62, 57, 69, 50][Math.floor(Math.random() * 4)])
    const dry = ctx.createGain()
    dry.gain.value = 0.05
    const wet = ctx.createGain()
    wet.gain.value = 0.22
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    const bus = ctx.createGain()
    if (pan) {
      pan.pan.value = rand(-0.6, 0.6)
      bus.connect(pan).connect(dry)
    } else bus.connect(dry)
    dry.connect(out)
    bus.connect(wet).connect(e.verb)
    let longest = 0
    const nodes: AudioNode[] = [dry, wet, bus]
    if (pan) nodes.push(pan)
    BELL_RATIOS.forEach((r, i) => {
      const o = ctx.createOscillator()
      o.frequency.value = f0 * r * (1 + rand(-0.002, 0.002))
      const g = ctx.createGain()
      const amp = 0.5 / (i + 1.4)
      const dur = Math.min(9, 7 / Math.sqrt(r))
      longest = Math.max(longest, dur)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(amp, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(bus)
      o.start(t)
      o.stop(t + dur + 0.05)
      nodes.push(o, g)
    })
    later((longest + 5) * 1000, () => nodes.forEach((n) => n.disconnect()))
  }
  every(30000, 60000, bell)

  // ---- heartbeat ----------------------------------------------------------------------------
  let beating = false
  const beatLp = ctx.createBiquadFilter()
  beatLp.type = 'lowpass'
  beatLp.frequency.value = 600
  const beatGain = ctx.createGain()
  beatGain.gain.value = 0.55
  beatLp.connect(beatGain).connect(out)
  const thump = (t: number, amp: number) => {
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(62, t)
    o.frequency.exponentialRampToValueAtTime(36, t + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(amp, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
    o.connect(g).connect(beatLp)
    o.start(t)
    o.stop(t + 0.36)
    // an audible partial (110 -> 70 Hz) and a short knock (~180 Hz) so laptop speakers hear the beat
    const p = ctx.createOscillator()
    p.type = 'triangle'
    p.frequency.setValueAtTime(110, t)
    p.frequency.exponentialRampToValueAtTime(70, t + 0.14)
    const pg = ctx.createGain()
    pg.gain.setValueAtTime(0, t)
    pg.gain.linearRampToValueAtTime(amp * 0.55, t + 0.01)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
    p.connect(pg).connect(beatLp)
    p.start(t)
    p.stop(t + 0.28)
    const k = ctx.createBufferSource()
    k.buffer = noiseBuffer(ctx, 'white', 1)
    const kb = ctx.createBiquadFilter()
    kb.type = 'bandpass'
    kb.frequency.value = 180
    kb.Q.value = 1.2
    const kg = ctx.createGain()
    kg.gain.setValueAtTime(0, t)
    kg.gain.linearRampToValueAtTime(amp * 0.5, t + 0.004)
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    k.connect(kb).connect(kg).connect(beatLp)
    k.start(t, rand(0, 0.8))
    k.stop(t + 0.1)
    o.onended = () => {
      ;[o, g, p, pg, k, kb, kg].forEach((n) => n.disconnect())
    }
  }
  const beat = () => {
    if (stopped || !beating) return
    if (live()) {
      const t = ctx.currentTime + 0.03
      thump(t, 0.6)
      thump(t + 0.27, 0.4)
    }
    later(1100, beat) // ~55 bpm
  }

  // ---- moods --------------------------------------------------------------------------------
  const applyMood = (m: Mood) => {
    const ritual = m === 'ritual'
    const bare = m === 'bare'
    glide(fifth.gain, ritual ? 0.07 : 0, 3)
    glide(padVoices[4].g.gain, ritual ? 0.1 : 0, 3)
    glide(padLp.frequency, ritual ? PAD_LP_RITUAL : PAD_LP, 3)
    glide(droneLp.frequency, ritual ? DRONE_LP_RITUAL : DRONE_LP, 3)
    if (bare) {
      glide(padGain.gain, 0, 2.5)
      glide(windGain.gain, 0.01, 2.5)
    } else if (padGain.gain.value < 0.2) {
      glide(padGain.gain, PAD_LEVEL, 3)
    }
  }

  return {
    setMood(m) {
      if (stopped || m === mood) return
      mood = m
      try {
        applyMood(m)
      } catch {
        /* ignore */
      }
    },
    heartbeat(on) {
      if (stopped || on === beating) return
      beating = on
      if (on) beat()
    },
    resolveBright() {
      if (stopped) return
      try {
        brightUntil = ctx.currentTime + 10
        voice(BRIGHT, 0.6)
        glide(padVoices[4].g.gain, 0.11, 1)
        glide(padGain.gain, 0.55, 1.2)
        glide(padLp.frequency, 2800, 1.5)
        later(10000, () => {
          chordIdx = 0
          voice(CHORDS[0], 2.5)
          applyMood(mood)
          glide(padLp.frequency, mood === 'ritual' ? PAD_LP_RITUAL : PAD_LP, 4)
          if (mood !== 'bare') glide(padGain.gain, PAD_LEVEL, 4)
        })
      } catch {
        /* ignore */
      }
    },
    dissonantSwell() {
      if (stopped) return
      try {
        const t = ctx.currentTime + 0.05
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(500, t)
        lp.frequency.linearRampToValueAtTime(1500, t + 4.5)
        lp.frequency.exponentialRampToValueAtTime(400, t + 11)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.2, t + 4.5)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 11.5)
        lp.connect(g).connect(out)
        const nodes: AudioNode[] = [lp, g]
        for (const n of [50, 51, 62, 63]) {
          // D and Eb: a minor-second cluster
          const o = ctx.createOscillator()
          o.type = 'sawtooth'
          o.frequency.value = midi(n)
          o.detune.value = rand(-6, 6)
          const og = ctx.createGain()
          og.gain.value = n < 56 ? 0.3 : 0.18
          o.connect(og).connect(lp)
          o.start(t)
          o.stop(t + 12)
          nodes.push(o, og)
        }
        later(13500, () => nodes.forEach((n) => n.disconnect()))
      } catch {
        /* ignore */
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      beating = false
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
      try {
        glide(out.gain, 0, ENDERS / 4)
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        sources.forEach((s) => {
          try {
            s.stop()
          } catch {
            /* already stopped */
          }
          s.disconnect()
        })
        out.disconnect()
      }, ENDERS * 1000)
    },
  }
}
