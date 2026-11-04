import type { Resurrection, ResurrectionStatus } from '@contracts/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, toApiRequestError, type ApiRequestError } from '../api'
import { usePageVisible } from './usePageVisible'

export const POLL_MS = 2000
const ERROR_RETRY_MS = 5000

export const ACTIVE_STATUSES: readonly ResurrectionStatus[] = ['summoning', 'building', 'checking_pulse']
export const isActive = (s: ResurrectionStatus | undefined) => !!s && ACTIVE_STATUSES.includes(s)

type State = {
  id: string
  data: Resurrection | null
  error: ApiRequestError | null
  clockOffsetMs: number
}

const blank = (id: string): State => ({ id, data: null, error: null, clockOffsetMs: 0 })

/**
 * Loads a resurrection and polls it every 2 s while it is summoning, building or
 * checking_pulse. Pauses while the tab is hidden and fetches again on return.
 * clockOffsetMs = Date.parse(server_time) - Date.now(), for countdown sync.
 */
export function useResurrection(id: string) {
  const visible = usePageVisible()
  const [state, setState] = useState<State>(() => blank(id))
  const [kick, setKick] = useState(0)
  const hasData = useRef(false)

  // reset when the id changes
  if (state.id !== id) {
    hasData.current = false
    setState(blank(id))
  }

  useEffect(() => {
    // Hidden tab: don't poll. A first load still happens so a background-opened tab isn't blank.
    if (!visible && hasData.current) return
    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      try {
        const r = await api.getResurrection(id)
        if (cancelled) return
        hasData.current = true
        setState({ id, data: r, error: null, clockOffsetMs: Date.parse(r.server_time) - Date.now() })
        if (visible && isActive(r.status)) timer = window.setTimeout(run, POLL_MS)
      } catch (e) {
        if (cancelled) return
        const err = toApiRequestError(e)
        setState((s) => (s.id === id ? { ...s, error: err } : s))
        // transient failures keep retrying; a 404 is final
        if (visible && err.status !== 404 && err.code !== 'not_found') timer = window.setTimeout(run, ERROR_RETRY_MS)
      }
    }
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, visible, kick])

  /** Fetch now (and keep polling if the record is still active). */
  const refetch = useCallback(() => setKick((k) => k + 1), [])

  /** Swap in a record returned by another call (e.g. retry) and restart polling. */
  const replace = useCallback(
    (r: Resurrection) => {
      hasData.current = true
      setState({ id, data: r, error: null, clockOffsetMs: Date.parse(r.server_time) - Date.now() })
      setKick((k) => k + 1)
    },
    [id],
  )

  const current = state.id === id ? state : blank(id)
  return { data: current.data, error: current.error, clockOffsetMs: current.clockOffsetMs, refetch, replace }
}
