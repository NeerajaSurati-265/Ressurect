import type { Ghost } from '@contracts/types'
import type { Ref } from 'react'
import type { ApiRequestError } from '../api'
import { Button } from '../components/Button'
import { CopyField } from '../components/CopyField'
import { TurnedAway } from '../components/TurnedAway'
import { COPY } from '../lib/copy'

const CONFIDENCE: Record<Ghost['confidence'], { label: string; cls: string }> = {
  high: { label: 'High confidence', cls: 'border-spectral/50 text-spectral' },
  medium: { label: 'Medium confidence', cls: 'border-ember-300/50 text-ember-300' },
  low: { label: 'Low confidence', cls: 'border-mist/50 text-mist' },
}

/** failed: what broke, how to fix it, and Try again. */
export function ErrorGhost({
  ghost,
  attempt,
  onRetry,
  retrying,
  retryError,
  headingRef,
}: {
  ghost: Ghost | null
  attempt: number
  onRetry: () => void
  retrying: boolean
  retryError: ApiRequestError | null
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const fallback = !ghost || ghost.source === 'fallback'
  const conf = ghost ? CONFIDENCE[ghost.confidence] : null

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="ghost-h" className="ghost-glass panel-enter rounded-2xl p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="ghost-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
            {fallback ? COPY.fallbackGhost : 'A ghost stirs. The build failed.'}
          </h2>
          {conf && !fallback && (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${conf.cls}`}>{conf.label}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-mist">Attempt {attempt} did not come back to life. Here is what the spirit says went wrong.</p>

        {ghost && (
          <dl className="mt-5 grid gap-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ember-300">Cause</dt>
              <dd className="mt-1 text-moon">{ghost.cause}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-spectral">Fix</dt>
              <dd className="mt-1 text-moon">{ghost.fix}</dd>
            </div>
          </dl>
        )}
        {ghost?.command && (
          <div className="mt-4">
            <CopyField label="Command to run" value={ghost.command} />
          </div>
        )}

        {ghost && ghost.raw_tail.length > 0 && (
          <details className="group mt-5 rounded-xl border border-moon/10 bg-night-950/60" open={fallback}>
            <summary className="cursor-pointer list-none rounded-xl px-4 py-3 font-type text-sm text-mist hover:text-ember-300">
              <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              Last words from the séance
            </summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 pb-4 font-type text-[13px] leading-relaxed text-[#ffb3b5]">
              {ghost.raw_tail.join('\n')}
            </pre>
          </details>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
            {retrying ? 'Calling the spirits back…' : 'Try again'}
          </Button>
          <p className="text-sm text-mist">Re-runs the autopsy and the build at your latest commit.</p>
        </div>
      </section>
      {retryError && <TurnedAway error={retryError} />}
    </div>
  )
}
