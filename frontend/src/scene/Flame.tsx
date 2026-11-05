import { useId, type CSSProperties } from 'react'

/**
 * A layered flame drawn inside any SVG: a soft orange envelope, an amber body and a hot
 * near-white core, each licking on its own seed-offset CSS timing so instances never sync.
 * No SVG filters (it animates every frame), only gradients, so it stays cheap.
 *
 * (x, y) is the base of the flame in the parent SVG's user units; at scale 1 the flame is ~10 x 22.
 */
export interface FlameProps {
  x: number
  y: number
  scale?: number
  /** per-instance seed so neighbouring flames never flicker in sync */
  seed?: number
  /** 0..1.5 brightness multiplier (e.g. the Keeper's lantern flares on a heartbeat) */
  intensity?: number
}

/** Deterministic 0..1 values from a seed (so SSR and every render agree). */
function seeded(seed: number, k: number) {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** Timing shared by a flame and its light, so the light flickers in step with the flame. */
function flameTiming(seed = 0) {
  return {
    lick: 1.1 + seeded(seed, 1) * 0.7,
    core: 0.7 + seeded(seed, 2) * 0.45,
    flicker: 1.9 + seeded(seed, 3) * 1.4,
    delay: -seeded(seed, 4) * 4,
  }
}

function safeId(raw: string) {
  return `fl${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

export function Flame({ x, y, scale = 1, seed = 0, intensity = 1 }: FlameProps) {
  const id = safeId(useId())
  const t = flameTiming(seed)
  const k = Math.max(0, Math.min(1.5, intensity))
  const anim = (name: string, dur: number, extra = 0): CSSProperties => ({
    animationName: name,
    animationDuration: `${dur}s`,
    animationDelay: `${t.delay - extra}s`,
  })
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0%" stopColor="#ffb35c" stopOpacity={0.5 * Math.min(1, k)} />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity={0.16 * Math.min(1, k)} />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-outer`} cx="50%" cy="88%" r="78%" fx="50%" fy="96%">
          <stop offset="0%" stopColor="#ffb347" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#ff7a12" stopOpacity="0.8" />
          <stop offset="80%" stopColor="#d9480a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a8330a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-mid`} cx="50%" cy="82%" r="70%">
          <stop offset="0%" stopColor="#ffe6a8" />
          <stop offset="55%" stopColor="#ffb347" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-core`} cx="50%" cy="75%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#fff3d1" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffe0a0" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* the light the flame throws on its immediate surroundings */}
      <ellipse
        cx="0"
        cy="-8"
        rx="16"
        ry="18"
        fill={`url(#${id}-halo)`}
        className="flame-flicker"
        style={anim('flame-flicker', t.flicker)}
      />
      <g className="flame-lick" style={anim('flame-lick', t.lick)} opacity={Math.min(1, 0.6 + 0.4 * k)}>
        <path d="M0 0.5C-5.4 -1.2 -6 -8.6 -2.6 -14.2C-1.6 -16.4 -0.6 -19.4 0.4 -23C1.6 -19 3.8 -15.6 4.7 -12.4C6.2 -7 4.6 -0.9 0 0.5Z" fill={`url(#${id}-outer)`} />
        <g className="flame-lick" style={anim('flame-lick-b', t.lick * 0.8, 0.3)}>
          <path d="M0 0C-3.6 -1.2 -4 -6.4 -1.6 -10.6C-0.8 -12.4 -0.2 -14.6 0.3 -16.6C1.4 -13.6 3 -11 3.4 -8.4C4.2 -4.4 3 -0.8 0 0Z" fill={`url(#${id}-mid)`} />
        </g>
        <g className="flame-lick" style={anim('flame-core', t.core, 0.1)}>
          <path d="M0 -0.4C-1.9 -1 -2.2 -3.8 -0.9 -6.4C-0.4 -7.6 0 -8.8 0.2 -10C1 -8 1.9 -6.6 2 -5C2.3 -2.6 1.6 -0.7 0 -0.4Z" fill={`url(#${id}-core)`} />
        </g>
      </g>
    </g>
  )
}

/**
 * The flame's light falling on nearby surfaces (ground, stones, a pumpkin's skin): a soft warm
 * ellipse that flickers in step with the <Flame/> of the same seed. Place it in any SVG.
 */
export function FlameLight({
  x,
  y,
  rx,
  ry,
  seed = 0,
  strength = 0.4,
  color = '#ff8a1f',
}: {
  x: number
  y: number
  rx: number
  ry: number
  seed?: number
  strength?: number
  color?: string
}) {
  const id = safeId(useId())
  const t = flameTiming(seed)
  return (
    <g aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-l`}>
          <stop offset="0%" stopColor={color} stopOpacity={strength} />
          <stop offset="35%" stopColor={color} stopOpacity={strength * 0.42} />
          <stop offset="70%" stopColor={color} stopOpacity={strength * 0.1} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx={x}
        cy={y}
        rx={rx}
        ry={ry}
        fill={`url(#${id}-l)`}
        className="flame-flicker"
        style={{ animationName: 'flame-flicker', animationDuration: `${t.flicker}s`, animationDelay: `${t.delay}s` }}
      />
    </g>
  )
}
