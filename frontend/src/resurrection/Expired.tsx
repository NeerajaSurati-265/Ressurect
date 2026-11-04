import type { Ref } from 'react'
import { Button, ButtonLink } from '../components/Button'
import { TurnedAway } from '../components/TurnedAway'
import { useStartRitual } from '../hooks/useStartRitual'
import { COPY } from '../lib/copy'

/** expired: the tombstone has slid shut. Offers a new resurrection of the same repo. */
export function Expired({ repoUrl, headingRef }: { repoUrl: string; headingRef?: Ref<HTMLHeadingElement> }) {
  const { start, busy, error } = useStartRitual()
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="expired-h" className="mist-glass panel-enter rounded-2xl p-6 text-center sm:p-8">
        <h2 id="expired-h" ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold text-moon outline-none sm:text-4xl">
          {COPY.expired}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-mist">
          This app's 20 minutes are up, so its files were deleted and the link no longer works. Resurrecting builds it again
          from the latest commit with a new link.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => start(repoUrl)} disabled={busy} aria-busy={busy}>
            {busy ? 'Performing the autopsy…' : 'Resurrect again'}
          </Button>
          <ButtonLink to="/">Back to the graveyard</ButtonLink>
        </div>
      </section>
      {error && <TurnedAway error={error} />}
    </div>
  )
}
