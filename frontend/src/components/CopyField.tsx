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
        <button
          type="button"
          onClick={async () => setState((await copyText(value)) ? 'copied' : 'failed')}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg border border-moon/20 bg-night-800/80 px-3 py-2 text-sm font-semibold text-moon hover:border-ember-300/60 hover:text-ember-300"
        >
          <CopyIcon />
          <span>{state === 'copied' ? 'Copied' : 'Copy'}</span>
          <span className="sr-only"> {label}</span>
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? `${label} copied to clipboard` : state === 'failed' ? 'Copy failed. Select the text and copy it manually.' : ''}
      </span>
    </div>
  )
}
