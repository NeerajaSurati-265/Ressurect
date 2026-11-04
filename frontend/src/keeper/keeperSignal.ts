/** Tiny module-level signal so the URL input can wake the Keeper (scene lives in Layout). */
type Listener = (e: { focus: boolean; flare: boolean }) => void
const listeners = new Set<Listener>()
let focused = false

export const keeperSignal = {
  focus(on: boolean) {
    focused = on
    listeners.forEach((l) => l({ focus: on, flare: false }))
  },
  flare() {
    listeners.forEach((l) => l({ focus: focused, flare: true }))
  },
  subscribe(l: Listener) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
