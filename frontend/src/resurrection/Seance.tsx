import type { LogLine, ResurrectionStatus } from '@contracts/types'
import { m } from 'framer-motion'
import { memo, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useReducedMotion } from '../scene/hooks'
import { DUR, EASE_OUT_EXPO } from '../styles/motion'
import { Candle, Rune } from './icons'
import { useTypewriter } from './useTypewriter'
import { keeperEvent } from '../keeper/store'
import { emit, type RitualPhase } from '../fx/events'

const PHASES = ['Summoning', 'Cloning', 'Installing', 'Building', 'Uploading'] as const

function phaseIndex(status: ResurrectionStatus, message: string): number | null {
  if (status === 'checking_pulse') return PHASES.length // all done
  if (status === 'summoning') return 0
  const msg = message.toLowerCase()
  if (msg.includes('upload')) return 4
  if (msg.includes('build')) return 3
  if (msg.includes('install') || msg.includes('dependenc')) return 2
  if (msg.includes('clon')) return 1
  if (msg.includes('summon') || msg.includes('queue')) return 0
  return null
}

function PhaseStrip({ status, message, reduced }: { status: ResurrectionStatus; message: string; reduced: boolean }) {
  // phase_message is free text; remember the furthest step we have recognised
  const furthest = useRef(0)
  const idx = phaseIndex(status, message)
  if (idx != null && idx > furthest.current) furthest.current = idx
  const current = idx ?? furthest.current
  const announced = useRef(-1)
  useEffect(() => {
    if (current < PHASES.length && current > announced.current) {
      announced.current = current
      emit('phase-change', { phase: PHASES[current].toLowerCase() as RitualPhase })
    }
  }, [current])
  return (
    <ol className="flex flex-wrap items-start justify-center gap-x-4 gap-y-3 sm:gap-x-6" aria-label="Ritual progress">
      {PHASES.map((p, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={p} className="flex w-16 flex-col items-center gap-1" aria-current={state === 'current' ? 'step' : undefined}>
            <m.span
              className={`relative grid h-9 w-9 place-items-center rounded-full border ${
                state === 'todo' ? 'border-moon/10 text-mist/45' : state === 'done' ? 'border-ember-500/35 text-ember-300' : 'border-ember-500/60 text-ember-300'
              }`}
              initial={false}
              animate={
                state === 'done'
                  ? { opacity: 1, scale: 1, filter: 'drop-shadow(0 0 5px rgba(255,138,31,0.55))' }
                  : state === 'current' && !reduced
                    ? { opacity: [0.7, 1, 0.7], scale: 1, filter: 'drop-shadow(0 0 3px rgba(255,138,31,0.35))' }
                    : { opacity: state === 'current' ? 1 : 0.8, scale: 1, filter: 'drop-shadow(0 0 0px rgba(255,138,31,0))' }
              }
              transition={
                state === 'current' && !reduced
                  ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: reduced ? 0 : DUR.uiSlow, ease: EASE_OUT_EXPO }
              }
            >
              <Rune index={i} className="h-5 w-5" />
            </m.span>
            <span className={`text-[11px] sm:text-xs ${state === 'todo' ? 'text-mist/70' : state === 'done' ? 'text-bone/85' : 'font-semibold text-ember-300'}`}>
              {p}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function lineClass(l: LogLine) {
  const t = l.text.toLowerCase()
  if (/\berror\b|failed|^x /.test(t)) return 'text-[#ff9a9d]'
  if (l.kind === 'system') return 'text-ember-300'
  if (l.kind === 'pulse') return 'text-spectral'
  return 'text-moon/90'
}

// Ink bleeding onto paper: blurred and faint, then sharp. Plays once when a line mounts.
// CSS keyframes (surfaces.css .ink-in) so a line can never be left blurred.
const Line = memo(function Line({ line, text, ink }: { line: LogLine; text?: string; ink: boolean }) {
  return (
    <div className={`whitespace-pre-wrap break-words ${ink ? 'ink-in ' : ''}${lineClass(line)}`}>
      {text ?? line.text}
      {text !== undefined && <span className="seance-caret" aria-hidden="true" />}
    </div>
  )
})

/** Candle-lit panel streaming the build log in a typewriter face. */
export function Seance({
  lines,
  status,
  phaseMessage,
  headingRef,
}: {
  lines: LogLine[]
  status: ResurrectionStatus
  phaseMessage: string
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const reduced = useReducedMotion()
  const { shown, chars } = useTypewriter(lines, !reduced)
  const boxRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [detached, setDetached] = useState(false)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown, chars, lines.length])

  const onScroll = () => {
    const el = boxRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28
    stick.current = atBottom
    setDetached(!atBottom)
  }

  // Candles flare when new lines arrive, at most once a second.
  const [flare, setFlare] = useState(0)
  const lastFlare = useRef(0)
  const seen = useRef(lines.length)
  useEffect(() => {
    if (lines.length <= seen.current) {
      seen.current = lines.length
      return
    }
    emit('log-lines', { count: lines.length - seen.current })
    seen.current = lines.length
    const now = performance.now()
    if (now - lastFlare.current >= 1000) {
      lastFlare.current = now
      setFlare((f) => f + 1)
      keeperEvent('line')
    }
  }, [lines.length])

  const typingLine = shown < lines.length ? lines[shown] : null
  const active = status === 'summoning' || status === 'building'

  return (
    <section aria-labelledby="seance-h" data-keeper-anchor="seance" className="seance-glass panel-enter relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,138,31,0.14),transparent)]" />
      <div className="relative flex items-end justify-between gap-4">
        <Candle className="h-16 w-7 shrink-0 sm:h-20 sm:w-9" flare={flare} />
        <div className="min-w-0 flex-1 text-center">
          <h2 id="seance-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
            {active ? 'The séance has begun' : 'The séance'}
          </h2>
          <p className="mt-1 text-sm text-mist">
            {active ? `${phaseMessage}…` : 'Transcript of the build'}
          </p>
        </div>
        <Candle className="h-16 w-7 shrink-0 sm:h-20 sm:w-9" delay={-0.7} flare={flare} />
      </div>

      {active && (
        <div className="relative mt-4 flex justify-center">
          <PhaseStrip status={status} message={phaseMessage} reduced={reduced} />
        </div>
      )}

      <div className="relative mt-4">
        <div
          ref={boxRef}
          onScroll={onScroll}
          role="log"
          aria-label="Build log"
          aria-live="off"
          tabIndex={0}
          className="h-72 overflow-y-auto rounded-xl border border-moon/10 bg-night-950/75 p-4 font-type text-[13px] leading-relaxed sm:h-80 sm:text-sm"
        >
          {lines.length === 0 && <p className="text-mist">Waiting for the spirits to speak…</p>}
          {/* one keyed list so a line that finishes typing keeps its element (the ink plays once) */}
          {lines.slice(0, typingLine ? shown + 1 : shown).map((l, i) =>
            i === shown ? (
              <Line key={i} line={l} ink={!reduced} text={l.text.slice(0, chars)} />
            ) : (
              <Line key={i} line={l} ink={!reduced} />
            ),
          )}
        </div>
        {detached && (
          <button
            type="button"
            onClick={() => {
              const el = boxRef.current
              if (el) el.scrollTop = el.scrollHeight
              stick.current = true
              setDetached(false)
            }}
            className="absolute bottom-3 right-4 cursor-pointer rounded-full bg-ember-500 px-3 py-1 text-xs font-semibold text-night-950 shadow-lg"
          >
            Jump to latest
          </button>
        )}
      </div>
    </section>
  )
}
