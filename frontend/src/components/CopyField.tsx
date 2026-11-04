import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useId, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { CopyIcon } from '../resurrection/icons'

/** A read-only value in a monospace box with a Copy button. */
export function CopyField({
  label,
  value,
  multiline = false,
  hideLabel = false,
}: {
  label: string
  value: string
  multiline?: boolean
  hideLabel?: boolean
}) {
  const id = useId()
  const reduce = useReducedMotion()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = window.setTimeout(() => setState('idle'), 2200)
    return () => window.clearTimeout(t)
  }, [state])

  return (
    <div>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-mist'}>
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        {multiline ? (
          <textarea
            id={id}
            readOnly
            value={value}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 resize-none rounded-lg border border-moon/15 bg-night-950/80 px-3 py-2 font-mono text-xs text-moon"
          />
        ) : (
          <input
            id={id}
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-moon/15 bg-night-950/80 px-3 py-2 font-mono text-sm text-moon"
          />
        )}
        <m.button
          type="button"
          onClick={async () => setState((await copyText(value)) ? 'copied' : 'failed')}
          whileTap={reduce ? undefined : { scale: 0.94 }}
          animate={
            state === 'copied' && !reduce
              ? { boxShadow: ['0 0 0 0 rgba(255,138,31,0.55)', '0 0 0 8px rgba(255,138,31,0)'] }
              : { boxShadow: '0 0 0 0 rgba(255,138,31,0)' }
          }
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={`relative inline-flex min-w-[6.5rem] shrink-0 cursor-pointer items-center justify-center gap-1.5 self-start rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-300 ${
            state === 'copied'
              ? 'border-ember-300/70 bg-ember-500/15 text-ember-300'
              : state === 'failed'
                ? 'border-[#ffb3b5]/50 bg-night-800/80 text-[#ffb3b5]'
                : 'border-moon/20 bg-night-800/80 text-moon hover:border-ember-300/60 hover:text-ember-300'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <m.span
              key={state === 'copied' ? 'check' : 'copy'}
              className="inline-flex"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -20 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {state === 'copied' ? (
                <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                  <m.path
                    d="M3 8.5L6.5 12L13 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: reduce ? 1 : 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  />
                </svg>
              ) : (
                <CopyIcon />
              )}
            </m.span>
          </AnimatePresence>
          <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Retry' : 'Copy'}</span>
          <span className="sr-only"> {label}</span>
        </m.button>
      </div>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? `${label} copied to clipboard` : state === 'failed' ? 'Copy failed. Select the text and copy it manually.' : ''}
      </span>
    </div>
  )
}
