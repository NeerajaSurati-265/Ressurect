import { useEffect, useRef, useState, type RefObject } from 'react'
import { tick } from './audioBridge'
import { speechDone, subscribeSpeech, type SpeechLine } from './dialogue'
import { hush, speak } from './voice'
import './speech.css'

/**
 * The Keeper's speech: a parchment scroll that types each line out, holds it, then fades.
 * Purely decorative (aria-hidden); the routes' aria-live regions carry the same news.
 *
 * The outer `.speech-pos` element is positioned per frame by the Keeper (beside the figure, or
 * in a free spot); without the figure (phones, or nowhere clear) it docks bottom-centre.
 */

const CHAR_MS = 31
const FADE_MS = 500
const FAST_FADE_MS = 180
const UNFURL_MS = 240
const holdFor = (len: number) => 2500 + 45 * len
/** a short breath after punctuation, like a voice would take */
const pauseAfter = (ch: string) => (ch === ',' ? 110 : /[.!?…:]/.test(ch) ? 190 : 0)

export function SpeechScroll({ posRef, docked }: { posRef: RefObject<HTMLDivElement | null>; docked: boolean }) {
  const [line, setLine] = useState<SpeechLine | null>(null)
  const [typed, setTyped] = useState(0)
  const [shown, setShown] = useState(false)
  const [fast, setFast] = useState(false)
  const reducedRef = useRef(false)

  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const f = () => (reducedRef.current = m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])

  useEffect(() => {
    /** the line on the scroll right now (kept in an object: the effect's own mutable state) */
    const st: { cur: SpeechLine | null } = { cur: null }
    const timers: number[] = []
    const clear = () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
    }
    const later = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms))
    }

    const finish = (l: SpeechLine) => {
      setFast(false)
      setShown(false)
      later(FADE_MS, () => {
        st.cur = null
        setLine(null)
        speechDone(l.id)
      })
    }

    const play = (l: SpeechLine) => {
      st.cur = l
      const chars = Array.from(l.text)
      setFast(false)
      setLine(l)
      // next frame, so the scroll mounts hidden and then transitions in
      later(16, () => setShown(true))
      speak(l.text)
      if (reducedRef.current) {
        setTyped(chars.length)
        later(holdFor(chars.length), () => finish(l))
        return
      }
      setTyped(0)
      let i = 0
      let inked = 0
      const typeNext = () => {
        const ch = chars[i]
        i++
        setTyped(i)
        if (ch.trim()) {
          inked++
          if (inked % 3 === 0) tick()
        }
        if (i >= chars.length) later(holdFor(chars.length), () => finish(l))
        else later(CHAR_MS + pauseAfter(ch), typeNext)
      }
      later(UNFURL_MS, typeNext)
    }

    const off = subscribeSpeech((l) => {
      if (l && st.cur && l.id === st.cur.id) return
      if (!l && !st.cur) return
      clear()
      if (st.cur) {
        // replaced or cut short: a quick fade, then the next line (if any)
        hush()
        st.cur = null
        setFast(true)
        setShown(false)
        later(FAST_FADE_MS, () => {
          if (l) play(l)
          else setLine(null)
        })
      } else if (l) {
        play(l)
      }
    })
    return () => {
      clear()
      off()
      hush()
    }
  }, [])

  const chars = line ? Array.from(line.text) : []
  return (
    <div ref={posRef} className={`speech-pos${docked ? ' is-docked' : ''}`} aria-hidden="true">
      {line && (
        <div key={line.id} className="speech-scroll" aria-hidden="true" data-shown={shown} data-fast={fast}>
          <span className="ss-roll ss-roll-l" />
          <span className="ss-roll ss-roll-r" />
          <p className="ss-text">
            {chars.map((c, i) => (
              <span key={i} className="ss-ch" data-on={i < typed ? '' : undefined}>
                {c}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}
