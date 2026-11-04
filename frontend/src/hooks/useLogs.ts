import type { LogLine } from '@contracts/types'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { POLL_MS } from './useResurrection'
import { usePageVisible } from './usePageVisible'

type State = { key: string; lines: LogLine[]; doneKey: string | null }

/**
 * Streams build logs: polls with the cursor every 2 s until done=true, appending lines.
 * Pauses while the tab is hidden. `attempt` restarts polling after a retry (the cursor
 * is kept, so lines are never fetched twice).
 */
export function useLogs(id: string, attempt: number) {
  const visible = usePageVisible()
  const [state, setState] = useState<State>({ key: id, lines: [], doneKey: null })
  const cursor = useRef<string | null>(null)
  const doneFor = useRef<string | null>(null)
  const runKey = `${id}#${attempt}`

  if (state.key !== id) {
    cursor.current = null
    doneFor.current = null
    setState({ key: id, lines: [], doneKey: null })
  }

  useEffect(() => {
    if (!visible) return
    if (doneFor.current === runKey) return
    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      try {
        const res = await api.getLogs(id, cursor.current)
        if (cancelled) return
        if (res.cursor != null) cursor.current = res.cursor
        if (res.done) doneFor.current = runKey
        setState((s) =>
          s.key === id
            ? { key: id, lines: res.lines.length ? [...s.lines, ...res.lines] : s.lines, doneKey: res.done ? runKey : s.doneKey }
            : s,
        )
        if (!res.done) timer = window.setTimeout(run, POLL_MS)
      } catch {
        if (cancelled) return
        timer = window.setTimeout(run, POLL_MS * 2)
      }
    }
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, runKey, visible])

  const current = state.key === id ? state : { lines: [] as LogLine[], doneKey: null }
  return { lines: current.lines, done: current.doneKey === runKey }
}
