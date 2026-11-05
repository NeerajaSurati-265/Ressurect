import { useCallback, useEffect, useRef, useState } from 'react'
import { releaseMusic, startAudio, turnOff } from '../audio/controller'
import { setSoundOn } from '../audio/prefs'
import { Button } from '../components/Button'
import { greet } from '../keeper/dialogue'
import { hasAsset } from '../lib/asset'
import { intro } from '../scene/intro'
import { prefersReducedMotion } from '../styles/motion'
import { gate } from './gateState'
import { revealLantern, type RevealHandle } from './reveal'
import './gate.css'

const BASE = import.meta.env.BASE_URL
const PROMO = `${BASE}intro/promo.mp4`
const POSTER = `${BASE}intro/poster.jpg`
const STALL_MS = 3000
const SKIP_AFTER_MS = 1000

type Phase = 'gate' | 'video' | 'transition'
type VideoCheck = 'checking' | 'yes' | 'no'

function saveData(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return !!c?.saveData
  } catch {
    return false
  }
}

/**
 * The entry gate: a dark misty screen with two ways in, then the promo video, then the fog and
 * lantern reveal of the landing page. Mounted by Layout only while gateWillShow and not done.
 */
export function EntryGate() {
  const [phase, setPhaseState] = useState<Phase>('gate')
  const [skipVisible, setSkipVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const [covered, setCovered] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const check = useRef<VideoCheck>(saveData() ? 'no' : 'checking')
  const withSound = useRef(false)
  const transitioning = useRef(false)
  const stallTimer = useRef(0)
  const reveal = useRef<RevealHandle | null>(null)
  const phaseRef = useRef<Phase>('gate')
  // the ref mirrors the state so event handlers and timers read the live phase
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  // Lock the page behind the gate.
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prev
      window.clearTimeout(stallTimer.current)
      reveal.current?.cancel()
    }
  }, [])

  const finish = useCallback(() => {
    gate.finish()
    intro.start() // the landing's letters rise now, after the reveal
    greet()
  }, [])

  /** Fog in, lantern reveal, done. Runs once, from wherever we are. */
  const toTransition = useCallback(() => {
    if (transitioning.current) return
    transitioning.current = true
    window.clearTimeout(stallTimer.current)
    setPhase('transition')
    const v = video.current
    const sound = withSound.current

    if (prefersReducedMotion()) {
      // a simple 600 ms crossfade
      gate.release()
      if (sound) releaseMusic(0.6)
      setFading(true)
      const t0 = performance.now()
      const fade = () => {
        const k = Math.min(1, (performance.now() - t0) / 600)
        if (v && !v.paused) v.volume = Math.max(0, 1 - k)
        if (k < 1) requestAnimationFrame(fade)
        else {
          v?.pause()
          finish()
        }
      }
      requestAnimationFrame(fade)
      return
    }

    const c = canvas.current
    if (!c) {
      gate.release()
      if (sound) releaseMusic(1.4)
      finish()
      return
    }
    reveal.current = revealLantern(c, {
      onFogProgress(k) {
        // the promo's audio fades out while the fog rolls in
        if (v && !v.paused) v.volume = Math.max(0, 1 - k)
      },
      onCovered() {
        if (v) {
          v.muted = true // iOS ignores volume; make sure it is silent
          v.pause()
        }
        setCovered(true) // from here the canvas alone covers the page
        gate.release() // the Keeper places itself under the fog
        if (sound) releaseMusic(1.4)
      },
      onDone: finish,
    })
  }, [finish, setPhase])

  // Preload the promo while the gate shows (unless the visitor asked to save data).
  useEffect(() => {
    if (check.current === 'no') return
    const live = { current: true }
    void hasAsset(PROMO, 'video/').then((ok) => {
      if (!live.current) return
      check.current = ok ? 'yes' : 'no'
      const v = video.current
      if (ok && v && !v.getAttribute('src')) {
        v.src = PROMO
        v.load()
      }
      // they already clicked while we were still looking: the file is not there
      if (!ok && phaseRef.current === 'video') toTransition()
    })
    return () => {
      live.current = false
    }
  }, [toTransition])

  // Skip appears after 1 s; Esc skips.
  useEffect(() => {
    if (phase !== 'video') return
    const t = window.setTimeout(() => setSkipVisible(true), SKIP_AFTER_MS)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        toTransition()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [phase, toTransition])

  const armStall = () => {
    window.clearTimeout(stallTimer.current)
    stallTimer.current = window.setTimeout(() => {
      if (phaseRef.current === 'video') toTransition()
    }, STALL_MS)
  }
  const clearStall = () => window.clearTimeout(stallTimer.current)

  /** Everything happens inside this one click: video play, audio context, prefs. */
  const enter = (sound: boolean) => {
    if (phaseRef.current !== 'gate') return
    gate.markSeen()
    withSound.current = sound
    if (sound) {
      setSoundOn(true)
      void startAudio({ hold: true }) // context resumes now, music stays silent until the reveal
    } else {
      turnOff()
    }

    const v = video.current
    if (check.current === 'no' || !v) {
      toTransition()
      return
    }
    if (!v.getAttribute('src')) {
      // still checking: start loading now; error or the stall timer catches a missing file
      v.src = PROMO
    }
    v.muted = !sound
    v.volume = 1
    setPhase('video')
    armStall()
    let p: Promise<void> | undefined
    try {
      p = v.play()
    } catch {
      toTransition()
      return
    }
    p?.catch(() => {
      if (transitioning.current) return
      if (!v.muted) {
        // unmuted playback refused: play it muted rather than not at all
        v.muted = true
        v.play().catch(() => toTransition())
      } else toTransition()
    })
  }

  const showVideo = phase === 'video' || (phase === 'transition' && !covered)
  const showScreen = phase === 'gate' || (phase === 'transition' && !covered)

  return (
    <div
      data-gate
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Resurrect"
      className={`gate fixed inset-0 z-[70] ${fading ? 'gate--fading' : ''}`}
      data-phase={phase}
    >
      {/* the gate screen: night, slow mist, the way in */}
      <div className={`gate__screen ${showScreen ? '' : 'gate__screen--gone'}`} aria-hidden={phase !== 'gate'}>
        <div className="gate__mist" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {phase === 'gate' && (
          <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="wordmark text-2xl font-bold tracking-[0.3em] text-ember-300 sm:text-3xl">RESURRECT</p>
            <p className="mt-4 max-w-sm text-sm text-mist">The gates are open. A short intro plays first (15 s, with sound).</p>
            <div className="mt-10 flex w-full max-w-xs flex-col items-center gap-5 sm:max-w-none">
              <Button
                autoFocus
                variant="primary"
                className="min-h-14 w-full px-8 text-lg sm:w-auto"
                onClick={() => enter(true)}
              >
                Enter the graveyard
              </Button>
              <button
                type="button"
                className="gate__quiet min-h-11 px-3 text-sm text-mist underline decoration-mist/40 underline-offset-4 hover:text-bone"
                onClick={() => enter(false)}
              >
                Enter in silence
              </button>
            </div>
            <p className="mt-8 text-xs text-mist/80">Press Esc during the intro to skip it.</p>
          </div>
        )}
      </div>

      {/* the promo: preloaded while the gate shows */}
      <video
        ref={video}
        className={`gate__video ${showVideo ? '' : 'gate__video--hidden'}`}
        poster={POSTER}
        preload="auto"
        playsInline
        muted
        disablePictureInPicture
        aria-label="Resurrect intro video"
        onPlaying={clearStall}
        onTimeUpdate={clearStall}
        onWaiting={() => phaseRef.current === 'video' && armStall()}
        onStalled={() => phaseRef.current === 'video' && armStall()}
        onError={() => {
          check.current = 'no'
          if (phaseRef.current === 'video') toTransition()
        }}
        onEnded={() => toTransition()}
      />

      {phase === 'video' && (
        <button
          type="button"
          className={`gate__skip ${skipVisible ? 'gate__skip--on' : ''}`}
          onClick={toTransition}
          tabIndex={skipVisible ? 0 : -1}
          aria-hidden={!skipVisible}
        >
          Skip <span aria-hidden="true">→</span>
        </button>
      )}

      {/* the fog and lantern reveal draws here */}
      <canvas ref={canvas} className="gate__canvas" aria-hidden="true" />
    </div>
  )
}
