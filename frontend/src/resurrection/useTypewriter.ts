import type { LogLine } from '@contracts/types'
import { useEffect, useRef, useState } from 'react'

const MS_PER_CHAR = 4
const SKIP_QUEUE = 20

/**
 * Types log lines out at ~4 ms per character. When 20+ lines are waiting (or
 * typing is disabled) everything queued appears at once.
 * Returns how many lines are fully shown and how many characters of the next.
 */
export function useTypewriter(lines: LogLine[], enabled: boolean) {
  const [pos, setPos] = useState({ shown: enabled ? 0 : lines.length, chars: 0 })
  const posRef = useRef(pos)
  posRef.current = pos

  const total = lines.length
  const queued = total - pos.shown
  if (pos.shown > total) setPos({ shown: total, chars: 0 })
  else if (queued > 0 && (!enabled || queued >= SKIP_QUEUE)) setPos({ shown: total, chars: 0 })

  const linesRef = useRef(lines)
  linesRef.current = lines
  const typing = enabled && queued > 0 && queued < SKIP_QUEUE

  useEffect(() => {
    if (!typing) return
    let raf = 0
    let last = performance.now()
    let carry = 0
    const tick = (now: number) => {
      carry += (now - last) / MS_PER_CHAR
      last = now
      let { shown, chars } = posRef.current
      const ls = linesRef.current
      let budget = Math.floor(carry)
      carry -= budget
      while (budget > 0 && shown < ls.length) {
        const left = ls[shown].text.length - chars
        if (budget >= left) {
          budget -= left
          shown += 1
          chars = 0
          budget = Math.max(0, budget - 8) // a short beat between lines
        } else {
          chars += budget
          budget = 0
        }
      }
      if (shown !== posRef.current.shown || chars !== posRef.current.chars) setPos({ shown, chars })
      if (shown < ls.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [typing])

  return pos
}
