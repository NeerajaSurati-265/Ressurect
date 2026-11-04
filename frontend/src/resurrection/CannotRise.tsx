import type { Autopsy } from '@contracts/types'
import type { Ref } from 'react'
import { ButtonLink, ExternalButton } from '../components/Button'
import { COPY } from '../lib/copy'
import { SeverityIcon } from './icons'

/** cannot_rise: the autopsy blocked the build. Lists the fixes, blocking first. */
export function CannotRise({
  autopsy,
  repoUrl,
  headingRef,
}: {
  autopsy: Autopsy
  repoUrl: string
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const fixes = autopsy.findings
    .filter((f) => f.fix && f.severity !== 'ok')
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1))

  return (
    <section aria-labelledby="cannot-h" className="mist-glass panel-enter rounded-2xl p-5 sm:p-7">
      <h2 id="cannot-h" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-moon outline-none sm:text-3xl">
        {COPY.cannotRiseHeadline}
      </h2>
      <p className="mt-2 text-mist">{COPY.cannotRiseBody}</p>

      {fixes.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-ember-300">What to fix</h3>
          <ol className="mt-2 grid gap-3">
            {fixes.map((f) => (
              <li key={f.id} className="flex gap-3 rounded-xl border border-moon/10 bg-night-950/50 p-3">
                <SeverityIcon severity={f.severity} className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold text-moon">{f.title}</p>
                  <p className="mt-0.5 text-sm text-moon/90">{f.fix}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink to="/" variant="primary">
          Try another grave
        </ButtonLink>
        <ExternalButton href={repoUrl} variant="ghost">
          Open the repo on GitHub
          <span className="sr-only">(opens in a new tab)</span>
        </ExternalButton>
      </div>
    </section>
  )
}
