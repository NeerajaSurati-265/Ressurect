import type { ResurrectionStatus } from '@contracts/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, toApiRequestError, type ApiRequestError } from '../api'
import { Button, ButtonLink } from '../components/Button'
import { TurnedAway } from '../components/TurnedAway'
import { useLogs } from '../hooks/useLogs'
import { isActive, useResurrection } from '../hooks/useResurrection'
import { STATUS_ANNOUNCEMENT } from '../lib/copy'
import { markLost, rememberResurrection } from '../lib/graveyard'
import { msUntil } from '../lib/time'
import { AutopsyReport } from '../resurrection/AutopsyReport'
import { CannotRise } from '../resurrection/CannotRise'
import { ErrorGhost } from '../resurrection/ErrorGhost'
import { Expired } from '../resurrection/Expired'
import { Grave, type GraveMode } from '../resurrection/Grave'
import { PulseCheck } from '../resurrection/PulseCheck'
import { Risen } from '../resurrection/Risen'
import { Seance } from '../resurrection/Seance'

export function ResurrectionView() {
  const { id = '' } = useParams()
  // Keyed by id so every local flag resets when navigating to a new resurrection.
  return <ResurrectionScreen key={id} id={id} />
}

const GRAVE_MODE: Record<ResurrectionStatus, GraveMode> = {
  summoning: 'rest',
  building: 'rest',
  checking_pulse: 'rest',
  alive: 'split',
  failed: 'haunted',
  cannot_rise: 'grey',
  expired: 'shut',
}

function ResurrectionScreen({ id }: { id: string }) {
  const { data, error, clockOffsetMs, refetch, replace } = useResurrection(id)
  const { lines } = useLogs(id, data?.attempt ?? 1)
  const [expiredLocally, setExpiredLocally] = useState(false)
  const [sawAlive, setSawAlive] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<ApiRequestError | null>(null)

  // An alive record whose clock has run out is shown as expired even before the server agrees.
  const pastExpiry =
    data?.status === 'alive' && !data.pinned && !!data.expires_at && msUntil(data.expires_at, clockOffsetMs) <= 0
  const status: ResurrectionStatus | null = data
    ? data.status === 'alive' && (expiredLocally || pastExpiry)
      ? 'expired'
      : data.status
    : null

  if (status === 'alive' && !sawAlive) setSawAlive(true)

  useEffect(() => {
    if (data) rememberResurrection(status === 'expired' ? { ...data, status: 'expired' } : data)
  }, [data, status])

  useEffect(() => {
    if (error?.code === 'not_found' || error?.status === 404) markLost(id)
  }, [error, id])

  useEffect(() => {
    if (data) document.title = `${data.repo.name} · Resurrect`
    return () => {
      document.title = 'Resurrect'
    }
  }, [data])

  // Plain-words announcement for screen readers whenever the status changes.
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (status) setAnnouncement(STATUS_ANNOUNCEMENT[status])
  }, [status])

  // Move focus to the new panel's heading when the screen changes (not on first load).
  const group = status ? (isActive(status) ? (status === 'checking_pulse' ? 'pulse' : 'ritual') : status) : null
  const firstGroup = useRef<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!group) return
    if (firstGroup.current === null) {
      firstGroup.current = group
      return
    }
    const t = window.setTimeout(() => headingRef.current?.focus({ preventScroll: false }), 50)
    return () => window.clearTimeout(t)
  }, [group])

  const onExpire = useCallback(() => {
    setExpiredLocally(true)
    refetch()
  }, [refetch])

  const onRetry = async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      const r = await api.retryResurrection(id)
      setExpiredLocally(false)
      replace(r)
    } catch (e) {
      setRetryError(toApiRequestError(e))
    } finally {
      setRetrying(false)
    }
  }

  if (!data) {
    if (error) {
      const gone = error.status === 404 || error.code === 'not_found'
      return (
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-16">
          <TurnedAway
            error={error}
            actions={
              <>
                {!gone && (
                  <Button variant="primary" onClick={refetch}>
                    Try again
                  </Button>
                )}
                <ButtonLink to="/" variant={gone ? 'primary' : 'ghost'}>
                  Back to the graveyard
                </ButtonLink>
              </>
            }
          />
        </div>
      )
    }
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-4 pb-24 pt-16" aria-busy="true">
        <p className="font-type text-lg text-mist">Reading the headstone…</p>
      </div>
    )
  }

  const s = status!
  const pulseLine = [...lines].reverse().find((l) => l.kind === 'pulse') ?? null

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-24 pt-6 sm:pt-10 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <aside className="lg:sticky lg:top-10">
        <div className="mx-auto w-[min(62vw,240px)] lg:w-full">
          <Grave name={data.repo.name} owner={data.repo.owner} mode={GRAVE_MODE[s]} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-5">
        <header className="text-center lg:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Resurrection {data.id}</p>
          <h1 className="mt-1 break-words font-display text-3xl font-bold text-moon sm:text-4xl">
            <a href={data.repo.url} target="_blank" rel="noopener noreferrer" className="rounded hover:text-ember-300">
              <span className="text-mist">{data.repo.owner}/</span>
              {data.repo.name}
              <span className="sr-only"> (opens GitHub in a new tab)</span>
            </a>
          </h1>
          <p className="mt-1 text-sm text-mist">
            Branch {data.repo.default_branch}
            {data.repo.commit_sha && <> · commit <code className="font-mono">{data.repo.commit_sha.slice(0, 7)}</code></>}
            {data.attempt > 1 && <> · attempt {data.attempt}</>}
          </p>
        </header>

        {error && (
          <p role="status" className="rounded-lg border border-ember-500/40 bg-night-950/70 px-3 py-2 text-sm text-ember-300">
            Lost contact with the spirits ({error.message}). Retrying…
          </p>
        )}

        <AutopsyReport
          autopsy={data.autopsy}
          collapsible={s === 'alive' || s === 'failed' || s === 'expired'}
          key={`autopsy-${data.attempt}`}
        />

        {(s === 'summoning' || s === 'building' || s === 'checking_pulse') && (
          <>
            {s === 'checking_pulse' && <PulseCheck pulse={data.pulse} lastLine={pulseLine} headingRef={headingRef} />}
            <Seance
              lines={lines}
              status={s}
              phaseMessage={data.phase_message}
              headingRef={s === 'checking_pulse' ? undefined : headingRef}
            />
          </>
        )}

        {s === 'alive' && <Risen record={data} clockOffsetMs={clockOffsetMs} onExpire={onExpire} headingRef={headingRef} />}

        {s === 'failed' && (
          <ErrorGhost
            ghost={data.ghost}
            attempt={data.attempt}
            onRetry={onRetry}
            retrying={retrying}
            retryError={retryError}
            headingRef={headingRef}
          />
        )}

        {s === 'cannot_rise' && <CannotRise autopsy={data.autopsy} repoUrl={data.repo.url} headingRef={headingRef} />}

        {s === 'expired' && (
          <>
            <Expired repoUrl={data.repo.url} headingRef={headingRef} />
            {sawAlive && <Risen record={data} clockOffsetMs={clockOffsetMs} dimmed />}
          </>
        )}
      </div>
    </div>
  )
}
