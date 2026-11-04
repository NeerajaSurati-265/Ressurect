import { useSyncExternalStore } from 'react'
import { intro } from './intro'

/** True while the first-load intro is running; flips to false on finish or skip. */
export function useIntroPlaying(): boolean {
  return useSyncExternalStore(intro.subscribe, intro.playing, () => false)
}
