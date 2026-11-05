/**
 * Late-bound bridge to the sound agent's modules (src/audio/prefs.ts, src/audio/sfx.ts).
 * import.meta.glob resolves at build time: a file that does not exist is simply absent from
 * the map, so tsc and the build stay green and every call here is a safe no-op until it lands.
 */

interface PrefsModule {
  getPrefs(): { soundOn: boolean; voiceOn: boolean }
  subscribePrefs(fn: (...args: unknown[]) => void): () => void
}
interface SfxModule {
  playWhoosh(): void
  playTick(): void
}

const loaders = import.meta.glob('../audio/{prefs,sfx}.ts')

let prefs: PrefsModule | null = null
let sfx: SfxModule | null = null
let loading: Promise<void> | null = null
const prefListeners = new Set<() => void>()

async function loadOne<T>(path: string): Promise<T | null> {
  const load = loaders[path]
  if (!load) return null
  try {
    return (await load()) as T
  } catch (e) {
    console.warn('[resurrect] keeper audio bridge could not load', path, e)
    return null
  }
}

/** Starts loading once; safe to call any number of times. */
export function loadAudio(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [p, s] = await Promise.all([loadOne<PrefsModule>('../audio/prefs.ts'), loadOne<SfxModule>('../audio/sfx.ts')])
      if (p && typeof p.getPrefs === 'function') {
        prefs = p
        try {
          p.subscribePrefs?.(() => prefListeners.forEach((l) => l()))
        } catch {
          /* ignore */
        }
        prefListeners.forEach((l) => l())
      }
      if (s) sfx = s
    })()
  }
  return loading
}

export function whoosh() {
  try {
    sfx?.playWhoosh()
  } catch {
    /* sound is decoration */
  }
}

export function tick() {
  try {
    sfx?.playTick()
  } catch {
    /* sound is decoration */
  }
}

/** True only when the prefs module is loaded and both sound and voice are on. */
export function canSpeak(): boolean {
  if (!prefs) return false
  try {
    const p = prefs.getPrefs()
    return !!(p.soundOn && p.voiceOn)
  } catch {
    return false
  }
}

/** Called whenever the sound/voice prefs change (and once when they first load). */
export function onPrefsChange(fn: () => void): () => void {
  prefListeners.add(fn)
  return () => {
    prefListeners.delete(fn)
  }
}
