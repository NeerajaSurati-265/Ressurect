import type { CSSProperties } from 'react'

/** SVG moon with a soft radial halo; two clouds drift slowly across it. */
export function Moon() {
  return (
    <div
      className="absolute"
      style={{ left: 'clamp(-20px, 4vw, 120px)', top: 'clamp(-30px, 1vh, 40px)', width: 'clamp(130px, 17vw, 280px)', aspectRatio: '1' }}
    >
      {/* broad, faint moonlight halo washing the sky around the disc */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: '520%',
          height: '520%',
          background:
            'radial-gradient(circle, rgba(201,212,236,0.16) 0%, rgba(143,163,199,0.07) 22%, rgba(143,163,199,0.025) 45%, transparent 68%)',
        }}
      />
      <svg viewBox="-150 -150 300 300" className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="moon-halo">
            <stop offset="0%" stopColor="#f4f6fc" stopOpacity="0.55" />
            <stop offset="22%" stopColor="#dbe3f4" stopOpacity="0.28" />
            <stop offset="40%" stopColor="#c9d4ec" stopOpacity="0.12" />
            <stop offset="60%" stopColor="#8fa3c7" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="moon-disc" cx="40%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#fbfcff" />
            <stop offset="65%" stopColor="#e9ecf5" />
            <stop offset="100%" stopColor="#c3cbe0" />
          </radialGradient>
        </defs>
        <circle r="150" fill="url(#moon-halo)" />
        <circle r="46" fill="url(#moon-disc)" style={{ filter: "drop-shadow(0 0 14px rgba(233,236,245,0.55))" }} />
        <g fill="#b8c1d8" opacity="0.45">
          <circle cx="-14" cy="-10" r="9" />
          <circle cx="16" cy="8" r="6" />
          <circle cx="-4" cy="20" r="4.5" />
          <circle cx="22" cy="-18" r="3.5" />
          <circle cx="-24" cy="12" r="3" />
        </g>
      </svg>
      <Cloud className="anim-cloud" style={{ top: '30%', left: '-30%', width: '95%', animationDuration: '80s' }} />
      <Cloud
        className="anim-cloud"
        flip
        style={{ top: '52%', left: '30%', width: '80%', animationDuration: '110s', animationDelay: '-40s' }}
      />
    </div>
  )
}

function Cloud({ className, style, flip }: { className: string; style: CSSProperties; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 220 60"
      className={`absolute ${className}`}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={flip ? 'translate(220 0) scale(-1 1)' : undefined}>
        <path
          d="M10 48 C 2 48, 2 36, 14 34 C 14 22, 32 18, 42 26 C 50 10, 78 8, 88 24 C 100 14, 124 16, 128 30 C 142 22, 166 26, 166 38 C 184 32, 206 38, 208 48 Z"
          fill="#161a33"
          fillOpacity="0.82"
        />
        <path
          d="M14 34 C 14 22, 32 18, 42 26 C 50 10, 78 8, 88 24 C 100 14, 124 16, 128 30"
          fill="none"
          stroke="#8fa3c7"
          strokeOpacity="0.28"
          strokeWidth="1.2"
        />
      </g>
    </svg>
  )
}
