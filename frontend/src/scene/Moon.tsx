import type { CSSProperties } from 'react'
import { MOON_BOX } from './layout'

/**
 * The cold key light. A full moon with limb darkening, soft turbulence maria and a layered
 * corona, plus thin semi-transparent cloud wisps whose moon-facing edges catch a silver rim.
 * Everything is static SVG (filters rasterise once); the wisps drift by CSS transform only.
 *
 * The disc carries `data-moon-disc` so the WebGL fog and god rays can find the light source.
 */
export function Moon() {
  return (
    <div className="absolute" style={MOON_BOX}>
      {/* broad, faint moonlight washing the sky: the widest layer of the corona */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: '560%',
          height: '560%',
          background:
            'radial-gradient(circle, rgba(214,224,244,0.15) 0%, rgba(160,178,214,0.07) 18%, rgba(143,163,199,0.03) 38%, transparent 64%)',
        }}
      />
      <svg viewBox="-150 -150 300 300" className="absolute inset-0 h-full w-full overflow-visible" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* corona: a bright tight ring of scattered light falling off fast, then a long tail */}
          <radialGradient id="moon-corona">
            <stop offset="0%" stopColor="#f6f8ff" stopOpacity="0.62" />
            <stop offset="30%" stopColor="#e4eaf8" stopOpacity="0.42" />
            <stop offset="36%" stopColor="#d6def2" stopOpacity="0.2" />
            <stop offset="52%" stopColor="#b9c6e4" stopOpacity="0.08" />
            <stop offset="75%" stopColor="#8fa3c7" stopOpacity="0.025" />
            <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
          </radialGradient>
          {/* limb darkening: bright, slightly warm centre falling to a cooler, dimmer edge */}
          <radialGradient id="moon-disc" cx="46%" cy="44%" r="58%">
            <stop offset="0%" stopColor="#fbfaf4" />
            <stop offset="55%" stopColor="#eeeee8" />
            <stop offset="82%" stopColor="#d6d9e2" />
            <stop offset="100%" stopColor="#aeb5c8" />
          </radialGradient>
          <radialGradient id="moon-limb" cx="40%" cy="38%" r="66%">
            <stop offset="70%" stopColor="#5d6788" stopOpacity="0" />
            <stop offset="100%" stopColor="#5d6788" stopOpacity="0.38" />
          </radialGradient>
          <clipPath id="moon-clip">
            <circle r="46" />
          </clipPath>
          {/* maria: low-frequency turbulence, thresholded softly into grey-blue seas */}
          <filter id="moon-maria" x="-50" y="-50" width="100" height="100" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="4" seed="7" result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 0.52  0 0 0 0 0.55  0 0 0 0 0.62  2.6 0.4 0 0 -1.45"
              result="seas"
            />
            <feGaussianBlur in="seas" stdDeviation="1.6" result="soft" />
            <feComposite in="soft" in2="SourceAlpha" operator="in" />
          </filter>
          {/* fine regolith grain and a few soft bright highland flecks */}
          <filter id="moon-grain" x="-50" y="-50" width="100" height="100" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="3" result="g" />
            <feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.62" result="fleck" />
            <feComposite in="fleck" in2="SourceAlpha" operator="in" />
          </filter>
        </defs>
        <circle r="150" fill="url(#moon-corona)" />
        <g data-moon-disc="">
          <circle r="46" fill="url(#moon-disc)" />
          <g clipPath="url(#moon-clip)">
            <circle r="46" fill="#000" filter="url(#moon-maria)" opacity="0.55" />
            <circle r="46" fill="#000" filter="url(#moon-grain)" opacity="0.12" />
            {/* the terminator side (lower right) falls off a touch more */}
            <circle r="46" fill="url(#moon-limb)" />
          </g>
        </g>
      </svg>
      <CloudWisp
        id="moon-wisp-a"
        className="anim-cloud"
        rimDir={1}
        style={{ top: '58%', left: '-34%', width: '120%', animationDuration: '90s' }}
      />
      <CloudWisp
        id="moon-wisp-b"
        className="anim-cloud"
        rimDir={-1}
        style={{ top: '18%', left: '42%', width: '96%', opacity: 0.8, animationDuration: '120s', animationDelay: '-50s' }}
      />
    </div>
  )
}

/**
 * A thin, wind-stretched cloud: turbulence-displaced blurred strands. The silver rim is the
 * blurred shape minus a copy shifted away from the moon (rimDir: 1 = moon is up-left, -1 = left).
 */
function CloudWisp({ id, className, style, rimDir }: { id: string; className: string; style: CSSProperties; rimDir: 1 | -1 }) {
  const dy = rimDir === 1 ? 5 : 2
  return (
    <svg viewBox="0 0 300 80" className={`absolute overflow-visible ${className}`} style={style} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id={id} x="-10%" y="-60%" width="120%" height="220%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="4" seed={rimDir === 1 ? 11 : 29} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="3.2" result="body" />
          <feOffset in="body" dx="5" dy={dy} result="shift" />
          <feComposite in="body" in2="shift" operator="out" result="edge" />
          <feFlood floodColor="#dfe6f6" floodOpacity="0.75" />
          <feComposite in2="edge" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="body" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <ellipse cx="150" cy="42" rx="128" ry="9" fill="#1c2244" fillOpacity="0.5" />
        <ellipse cx="110" cy="34" rx="70" ry="6" fill="#262c52" fillOpacity="0.42" />
        <ellipse cx="200" cy="50" rx="80" ry="5" fill="#1a1f3e" fillOpacity="0.4" />
      </g>
    </svg>
  )
}
