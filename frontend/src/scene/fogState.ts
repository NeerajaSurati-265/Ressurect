import { useSyncExternalStore } from 'react'

/**
 * Tiny module-level flag shared by FogCanvas (writer) and Scene (reader) so the WebGL fog and the
 * CSS GroundFog are never drawn together. It is true only while the WebGL fog is actually rendering.
 */
let webglFogActive = false
const listeners = new Set<() => void>()

export function setWebglFogActive(on: boolean) {
  if (webglFogActive === on) return
  webglFogActive = on
  listeners.forEach((l) => l())
}

export function isWebglFogActive() {
  return webglFogActive
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useWebglFogActive(): boolean {
  return useSyncExternalStore(subscribe, isWebglFogActive, () => false)
}
