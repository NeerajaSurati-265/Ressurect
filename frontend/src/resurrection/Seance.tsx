import type { LogLine, ResurrectionStatus } from '@contracts/types'
import { memo, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useReducedMotion } from '../scene/hooks'
import { Candle } from './icons'
import { useTypewriter } from './useTypewriter'

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

function PhaseStrip({ status, message }: { status: ResurrectionStatus; message: string }) {
  // phase_message is free text; remember the furthest step we have recognised
  const furthest = useRef(0)
  const idx = phaseIndex(status, message)
  if (idx != null && idx > furthest.current) furthest.current = idx
  const current = idx ?? furthest.current
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs sm:text-sm" aria-label="Ritual progress">
      {PHASES.map((p, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={p} className="flex items-center gap-1.5" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={
                state === 'done'
                  ? 'rounded-full px-2.5 py-1 text-spectral'
                  : state === 'current'
                    ? 'phase-current rounded-full border border-ember-500/60 bg-ember-500/15 px-2.5 py-1 font-semibold text-ember-300'
                    : 'rounded-full px-2.5 py-1 text-mist/70'
              }
            >
              {state === 'done' && <span aria-hidden="true">✓ </span>}
              {p}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
            {i < PHASES.length - 1 && (
              <span aria-hidden="true" className="text-mist/50">
                ›
              </span>
            )}
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

const Line = memo(function Line({ line, text }: { line: LogLine; text?: string }) {
  return (
    <div className={`whitespace-pre-wrap break-words ${lineClass(line)}`}>
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

  const typingLine = shown < lines.length ? lines[shown] : null
  const active = status === 'summoning' || status === 'building'

  return (
    <section aria-labelledby="seance-h" className="seance-glass panel-enter relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,138,31,0.14),transparent)]" />
      <div className="relative flex items-end justify-between gap-4">
        <Candle className="h-16 w-7 shrink-0 sm:h-20 sm:w-9" />
        <div className="min-w-0 flex-1 text-center">
          <h2 id="seance-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
            {active ? 'The séance has begun' : 'The séance'}
          </h2>
          <p className="mt-1 text-sm text-mist">
            {active ? `${phaseMessage}…` : 'Transcript of the build'}
          </p>
        </div>
        <Candle className="h-16 w-7 shrink-0 sm:h-20 sm:w-9" delay={-0.7} />
      </div>

      {active && (
        <div className="relative mt-4 flex justify-center">
          <PhaseStrip status={status} message={phaseMessage} />
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
          {lines.slice(0, shown).map((l, i) => (
            <Line key={i} line={l} />
          ))}
          {typingLine && <Line key={shown} line={typingLine} text={typingLine.text.slice(0, chars)} />}
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
