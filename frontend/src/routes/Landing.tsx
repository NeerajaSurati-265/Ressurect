import type { CreateResurrectionRequest } from '@contracts/types'
import { Button } from '../components/Button'
import { Graveyard } from '../components/Graveyard'
import { Hero } from '../components/Hero'
import { TurnedAway } from '../components/TurnedAway'
import { useStartRitual } from '../hooks/useStartRitual'
import { useGraveyard } from '../lib/graveyard'
import { useKeeperScript } from '../keeper/store'

export function Landing() {
  const { start, busy, error, reset } = useStartRitual()
  const handleSubmit = (req: CreateResurrectionRequest) => start(req.repo_url)
  const graves = useGraveyard()
  useKeeperScript(
    error ? 'barred' : 'idle',
    error
      ? [{ mood: 'barred', anchor: 'turned-away', whisper: 'The gate is shut.' }]
      : [{ mood: 'idle', anchor: 'url-input' }],
  )
  const below =
    graves.length > 0 && !error ? (
      <a
        href="#graveyard-h"
        className="mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm text-mist hover:text-ember-300"
      >
        Your graveyard · {graves.length} {graves.length === 1 ? 'grave' : 'graves'}
        <span aria-hidden="true">↓</span>
      </a>
    ) : null

  return (
    <>
      <Hero onSubmit={handleSubmit} busy={busy} below={below}>
        {error ? (
          <TurnedAway
            error={error}
            actions={
              <Button variant="primary" onClick={reset}>
                Try another grave
              </Button>
            }
          />
        ) : undefined}
      </Hero>
      <Graveyard />
    </>
  )
}
