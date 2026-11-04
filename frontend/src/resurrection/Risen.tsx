import type { Resurrection } from '@contracts/types'
import type { Ref } from 'react'
import { api } from '../api'
import { ExternalButton } from '../components/Button'
import { CopyField } from '../components/CopyField'
import { COPY } from '../lib/copy'
import { Countdown } from './Countdown'

/** alive: "It lives.", the live link, the README badge and the countdown. */
export function Risen({
  record,
  clockOffsetMs,
  onExpire,
  dimmed = false,
  headingRef,
}: {
  record: Resurrection
  clockOffsetMs: number
  onExpire?: () => void
  dimmed?: boolean
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const url = record.live_url ?? ''
  const badge = api.badgeUrl(record.id)
  const uiLink = `${window.location.origin}/r/${record.id}`
  const markdown = record.badge_markdown ?? `[![Resurrected](${badge})](${uiLink})`

  return (
    <section
      aria-labelledby="risen-h"
      inert={dimmed}
      className={`risen-glass panel-enter rounded-2xl p-5 transition-[opacity,filter] duration-1000 sm:p-7 ${dimmed ? 'pointer-events-none opacity-40 grayscale' : ''}`}
    >
      <h2
        id="risen-h"
        ref={headingRef}
        tabIndex={-1}
        className="risen-title text-center font-display text-4xl font-bold text-spectral outline-none sm:text-5xl"
      >
        {COPY.alive}
      </h2>
      <p className="mt-2 text-center text-mist">
        Your app is live. Anyone with the link can open it until the timer runs out.
      </p>

      <div className="mt-6 flex justify-center">
        {url ? (
          <ExternalButton href={url} variant="spectral" className="px-8 py-4 text-lg">
            Visit the risen app
            <span aria-hidden="true">↗</span>
            <span className="sr-only">(opens in a new tab)</span>
          </ExternalButton>
        ) : (
          <p className="text-mist">The live link is on its way…</p>
        )}
      </div>

      <div className="mt-7">
        <Countdown expiresAt={record.expires_at} pinned={record.pinned} clockOffsetMs={clockOffsetMs} onExpire={onExpire} />
      </div>

      <div className="mt-7 grid gap-5 border-t border-moon/10 pt-6">
        {url && <CopyField label="Live URL" value={url} />}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mist">README badge</p>
          <img src={badge} alt={`Resurrected badge for ${record.repo.name}`} height={20} className="mb-3 h-5 w-auto" />
          <CopyField label="Badge markdown" value={markdown} multiline hideLabel />
        </div>
      </div>
    </section>
  )
}
