import { useSyncExternalStore } from 'react'
import { intro } from './intro'

/** True while the first-load intro is running; flips to false on finish or skip. */
export function useIntroPlaying(): boolean {
  return useSyncExternalStore(intro.subscribe, intro.playing, () => false)
}

/** True while the intro waits behind the entry gate (the letters stay hidden). */
export function useIntroHeld(): boolean {
  return useSyncExternalStore(intro.subscribe, intro.held, () => false)
}
