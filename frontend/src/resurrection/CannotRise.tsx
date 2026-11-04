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
      <HeavyStone />
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

/** A heavy slab resting over the grave, moon rim-light on top, spirits asleep beneath. */
function HeavyStone() {
  return (
    <svg viewBox="0 0 160 70" className="mb-3 h-14 w-32" aria-hidden="true">
      <defs>
        <linearGradient id="cr-slab" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5a5d68" />
          <stop offset="100%" stopColor="#202230" />
        </linearGradient>
        <radialGradient id="cr-sleep">
          <stop offset="0%" stopColor="#c9d4ec" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#c9d4ec" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M4 66C40 58 120 58 156 66Z" fill="#0d1020" />
      <path d="M18 60L26 34H134L142 60Z" fill="url(#cr-slab)" stroke="#07080f" strokeWidth="1.5" />
      <path d="M27 35H133" stroke="#c9d4ec" strokeOpacity="0.4" strokeWidth="1.2" />
      <path d="M70 36L76 46L72 52L78 59" fill="none" stroke="#07080f" strokeOpacity="0.8" strokeWidth="1.3" />
      <path d="M50 48H62M98 48H110" stroke="#07080f" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="50" cy="22" rx="12" ry="8" fill="url(#cr-sleep)" className="anim-pulse-soft" />
      <ellipse cx="112" cy="18" rx="10" ry="7" fill="url(#cr-sleep)" />
      <path d="M46 22q2 -2 4 0M108 18q2 -2 4 0" stroke="#c9d4ec" strokeOpacity="0.45" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  )
}
