import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, toApiRequestError, type ApiRequestError } from '../api'
import { rememberResurrection } from '../lib/graveyard'

/** POST /resurrections, remember it in the graveyard, then go to /r/:id. */
export function useStartRitual() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const inFlight = useRef(false)

  const start = useCallback(
    async (repoUrl: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setError(null)
      try {
        const r = await api.createResurrection(repoUrl)
        rememberResurrection(r)
        navigate(`/r/${r.id}`, { state: { fresh: true } })
      } catch (e) {
        setError(toApiRequestError(e))
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [navigate],
  )

  const reset = useCallback(() => setError(null), [])
  return { start, busy, error, reset }
}
