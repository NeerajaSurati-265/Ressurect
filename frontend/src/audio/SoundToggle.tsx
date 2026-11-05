import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { gate } from '../gate/gateState'
import { checkTheme, getStatus, startAudio, subscribeStatus, turnOff, turnOn } from './controller'
import { setVoiceOn, setVolume, usePrefs } from './prefs'
import './SoundToggle.css'

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const

/** A small hanging lantern-bell; its flame glows ember when sound is on. Original, drawn in code. */
function LanternIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none">
      <defs>
        <radialGradient id="st-flame" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#ffd9a0" />
          <stop offset="45%" stopColor="#ff8a2a" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="sound-toggle__lantern" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        {/* chain and ring */}
        <path d="M12 1v2.2" opacity="0.7" />
        <circle cx="12" cy="4.1" r="0.9" />
        {/* cap */}
        <path d="M8.6 7.2 12 5l3.4 2.2z" />
        {/* bell-shaped body */}
        <path d="M9 7.4c-.4 3.2-.9 7.2-2.3 9.6h10.6c-1.4-2.4-1.9-6.4-2.3-9.6" />
        <path d="M6.2 17h11.6" />
        {/* glass panes */}
        <path d="M12 7.6v9" opacity="0.35" />
        {/* clapper */}
        <path d="M12 17v2.4" opacity="0.8" />
        <circle className="sound-toggle__glow" cx="12" cy="13" r="4.6" fill="url(#st-flame)" stroke="none" />
        <path className="sound-toggle__glow" d="M12 10.4c.9 1.1 1.3 1.9 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.6z" fill="#ffb35a" stroke="none" />
        <circle cx="12" cy="20.1" r="0.8" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}

function VolumeIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />
      {level > 0 && <path d="M10.2 6.1a2.6 2.6 0 0 1 0 3.8" />}
      {level > 0.5 && <path d="M12 4.4a5 5 0 0 1 0 7.2" opacity="0.75" />}
      {level === 0 && <path d="M10.5 6.2l3 3.6M13.5 6.2l-3 3.6" />}
    </svg>
  )
}

/** A small popover with the music volume slider (remembered in localStorage by prefs). */
function VolumeControl() {
  const { volume } = usePrefs()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (ev: PointerEvent) => {
      if (wrap.current && ev.target instanceof Node && !wrap.current.contains(ev.target)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pct = Math.round(volume * 100)
  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(ev) => {
        if (wrap.current && !wrap.current.contains(ev.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Music volume, ${pct}%`}
        title="Music volume"
        onClick={() => setOpen((o) => !o)}
        className="sound-toggle__btn flex h-10 w-10 items-center justify-center rounded-full text-bone"
      >
        <VolumeIcon level={volume} />
      </button>
      {open && (
        <div id={id} className="sound-toggle__pop absolute right-0 top-full mt-2 flex items-center gap-3 rounded-2xl px-4 py-3">
          <label htmlFor={`${id}-range`} className="sr-only">
            Music volume
          </label>
          <input
            id={`${id}-range`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            autoFocus
            onChange={(ev) => setVolume(Number(ev.currentTarget.value) / 100)}
            className="sound-toggle__range w-32"
          />
          <span className="w-8 text-right text-xs tabular-nums text-mist" aria-hidden="true">
            {pct}
          </span>
        </div>
      )}
    </div>
  )
}

function MouthIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <path d="M3 9.5c2-1.6 3.4-1.6 5 0 1.6-1.6 3-1.6 5 0" />
      <path d="M4.5 3.5c1 .6 1 1.8 0 2.4M8 2.5c1.4.9 1.4 2.9 0 3.8M11.5 3.5c1 .6 1 1.8 0 2.4" opacity="0.6" />
    </svg>
  )
}

export function SoundToggle() {
  const status = useSyncExternalStore(subscribeStatus, getStatus, () => 'unsupported' as const)
  const { voiceOn } = usePrefs()

  // Look for the optional theme file early (a HEAD request, no sound).
  useEffect(() => {
    if (status !== 'unsupported') void checkTheme()
  }, [status])

  // Sound was left on: wait for the first real gesture anywhere, then start (once).
  useEffect(() => {
    if (status !== 'waiting') return
    const handler = (ev: Event) => {
      const t = ev.target
      // the gate decides about sound itself ("Enter in silence" must not wake the music)
      if (gate.isActive()) return
      if (t instanceof Element && (t.closest('.sound-toggle') || t.closest('[data-gate]'))) return
      if (ev instanceof KeyboardEvent && ev.key === 'Escape') return
      void startAudio().then((running) => {
        if (running) GESTURES.forEach((g) => window.removeEventListener(g, handler, true))
      })
    }
    GESTURES.forEach((g) => window.addEventListener(g, handler, { capture: true, passive: true }))
    return () => GESTURES.forEach((g) => window.removeEventListener(g, handler, true))
  }, [status])

  if (status === 'unsupported') return null

  const on = status !== 'off'
  const label = status === 'on' ? 'Silence' : status === 'waiting' ? 'Wake the music' : 'Summon the music'
  const aria = status === 'on' ? 'Silence the music' : status === 'waiting' ? 'Music is on: press to start it' : 'Summon the music'

  const onClick = () => {
    if (status === 'on') turnOff()
    else if (status === 'waiting') void startAudio({ chime: true })
    else void turnOn()
  }

  return (
    <div className="sound-toggle fixed top-4 right-4 z-50 flex flex-col items-end gap-1.5" data-status={status}>
      <div className="flex items-center gap-1.5">
      {on && <VolumeControl />}
      <button
        type="button"
        aria-pressed={on}
        aria-label={aria}
        title={label}
        onClick={onClick}
        className="sound-toggle__btn flex h-10 min-w-10 items-center justify-center gap-2 rounded-full px-0 text-bone sm:px-3.5"
      >
        <span className={status === 'off' ? 'text-mist' : 'text-bone'}>
          <LanternIcon />
        </span>
        <span className="hidden text-xs tracking-wide sm:inline">{label}</span>
      </button>
      </div>
      {on && (
        <button
          type="button"
          aria-pressed={voiceOn}
          aria-label="Let the Keeper speak"
          title="Let the Keeper speak"
          onClick={() => setVoiceOn(!voiceOn)}
          className={`sound-toggle__btn flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-0 text-[11px] sm:px-3 ${
            voiceOn ? 'text-ember-300' : 'text-mist'
          }`}
        >
          <MouthIcon />
          <span className="hidden sm:inline">Let the Keeper speak</span>
          <span
            aria-hidden="true"
            className={`hidden h-1.5 w-1.5 rounded-full sm:inline-block ${voiceOn ? 'bg-ember-500' : 'bg-mist/40'}`}
          />
        </button>
      )}
    </div>
  )
}
