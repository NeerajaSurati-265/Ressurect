import { canSpeak, onPrefsChange } from './audioBridge'

/**
 * The Keeper's spoken voice: the browser's speech synthesis, pitched low and slow.
 * Speaks only when sound and voice are both on. One line at a time, always.
 */

let voice: SpeechSynthesisVoice | null = null
let started = false

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

const DEEP = /\bmale\b|daniel|fred|alex|george|david|ralph|bruce|deep|low|arthur|oliver|thomas|james|guy|ryan|mark/i
const NOT_DEEP = /female|woman|girl|samantha|victoria|karen|zira|susan|moira|tessa|fiona|kate|serena|hazel|aria|jenny/i

function pickVoice() {
  const s = synth()
  if (!s) return
  let all: SpeechSynthesisVoice[] = []
  try {
    all = s.getVoices()
  } catch {
    return
  }
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang))
  if (!en.length) {
    voice = null
    return
  }
  const deep = en.filter((v) => DEEP.test(v.name) && !NOT_DEEP.test(v.name))
  const pool = deep.length ? deep : en
  // local voices start instantly and work offline; prefer them, then GB/US
  const score = (v: SpeechSynthesisVoice) => (v.localService ? 2 : 0) + (/en[-_](GB|US)/i.test(v.lang) ? 1 : 0)
  voice = [...pool].sort((a, b) => score(b) - score(a))[0] ?? null
}

/** Idempotent: picks a voice now and again whenever the voice list loads late. */
export function initVoice() {
  if (started) return
  started = true
  const s = synth()
  if (!s) return
  pickVoice()
  try {
    s.addEventListener('voiceschanged', pickVoice)
  } catch {
    /* older engines */
  }
  onPrefsChange(() => {
    if (!canSpeak()) hush()
  })
}

/** Speaks `text`, cutting off anything already being said. Silent when voice is off or missing. */
export function speak(text: string) {
  const s = synth()
  if (!s) return
  try {
    s.cancel()
    if (!canSpeak()) return
    if (!voice) pickVoice()
    if (!voice) return
    const u = new SpeechSynthesisUtterance(text.replace(/…/g, '...'))
    u.voice = voice
    u.lang = voice.lang
    u.pitch = 0.5
    u.rate = 0.85
    u.volume = 0.9
    s.speak(u)
  } catch {
    /* speech is decoration */
  }
}

export function hush() {
  try {
    synth()?.cancel()
  } catch {
    /* ignore */
  }
}
