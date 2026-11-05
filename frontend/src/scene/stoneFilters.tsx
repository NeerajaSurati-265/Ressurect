import { MOON_AZIMUTH, MOON_ELEVATION, type StoneIds } from './stoneIds'

/**
 * Shared carved-stone filter set, rendered once per SVG that needs it (ids are namespaced with
 * useId, so several SVGs on one page never collide). Light comes from the moon: upper left.
 *
 * - carve:   weathered edges (turbulence displacement) + a carved, pitted surface lit by a
 *            distant light from the moon's azimuth (feDiffuseLighting on a bevel + grit bump map).
 * - engrave: chiselled lettering: a dark groove, an inner shadow on the upper-left wall and a
 *            highlight catching the lower-right wall.
 * - moss:    turbulence-masked green-grey patches; apply it to a shape whose fill alpha says
 *            where moss may grow (e.g. a gradient strong at the base).
 * - soil:    dark grit specks for earth and mounds.
 *
 * Mind performance: these are heavy. Apply them to static groups only and keep any animated
 * transform on a parent group so the filter output can be cached by the rasteriser.
 */
export function StoneFilterDefs({
  ids,
  seed = 3,
  wear = 3.2,
  bevel = 2.2,
  lightColor = '#cdd7ee',
  groove = 0.62,
}: {
  ids: StoneIds
  seed?: number
  /** displacement amount for the weathered edge, in user units */
  wear?: number
  /** bevel softness (blur radius of the alpha used as a height map) */
  bevel?: number
  lightColor?: string
  /** darkness of the engraved groove floor (raise it where the lettering must be read) */
  groove?: number
}) {
  return (
    <defs>
      <filter id={ids.carve} x="-8%" y="-6%" width="116%" height="112%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed={seed} result="coarse" />
        <feDisplacementMap in="SourceGraphic" in2="coarse" scale={wear} xChannelSelector="R" yChannelSelector="G" result="worn" />
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed={seed + 5} result="fine" />
        <feGaussianBlur in="worn" stdDeviation={bevel} result="round" />
        <feComposite in="round" in2="coarse" operator="arithmetic" k1="0" k2="1" k3="0.22" k4="0" result="bumpA" />
        <feComposite in="bumpA" in2="fine" operator="arithmetic" k1="0" k2="1" k3="0.1" k4="0" result="bump" />
        <feDiffuseLighting in="bump" surfaceScale="3.2" diffuseConstant="1.1" lightingColor={lightColor} result="light">
          <feDistantLight azimuth={MOON_AZIMUTH} elevation={MOON_ELEVATION} />
        </feDiffuseLighting>
        <feComposite in="worn" in2="light" operator="arithmetic" k1="0.95" k2="0.04" k3="0" k4="0" result="lit" />
        <feComposite in="lit" in2="worn" operator="in" />
      </filter>

      <filter id={ids.engrave} x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB">
        {/* the groove floor */}
        <feFlood floodColor="#0b0d18" floodOpacity={groove} />
        <feComposite in2="SourceAlpha" operator="in" result="floor" />
        {/* upper-left inner wall falls in shadow */}
        <feOffset in="SourceAlpha" dx="0.9" dy="1.1" result="down" />
        <feComposite in="SourceAlpha" in2="down" operator="out" result="tlWall" />
        <feFlood floodColor="#000" floodOpacity="0.85" />
        <feComposite in2="tlWall" operator="in" result="shadow" />
        {/* lower-right inner wall catches the moon */}
        <feOffset in="SourceAlpha" dx="-0.8" dy="-0.9" result="up" />
        <feComposite in="SourceAlpha" in2="up" operator="out" result="brWall" />
        <feFlood floodColor="#d6def2" floodOpacity="0.42" />
        <feComposite in2="brWall" operator="in" result="lip" />
        <feMerge>
          <feMergeNode in="floor" />
          <feMergeNode in="shadow" />
          <feMergeNode in="lip" />
        </feMerge>
      </filter>

      <filter id={ids.moss} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.09 0.13" numOctaves="3" seed={seed + 11} result="n" />
        {/* green-grey around #6b8455, varying with the noise; alpha is a soft threshold */}
        <feColorMatrix
          in="n"
          type="matrix"
          values="0.25 0 0 0 0.24  0.28 0 0 0 0.31  0.18 0 0 0 0.2  0 3 0 0 -1.35"
          result="patches"
        />
        <feGaussianBlur in="patches" stdDeviation="0.7" result="soft" />
        <feComposite in="soft" in2="SourceGraphic" operator="in" />
      </filter>

      <filter id={ids.soil} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.8 0.4" numOctaves="2" seed={seed + 2} result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.01  0 0 0 0 0.012  0 0 0 0 0.03  0 0 0 3.2 -1.5" result="dark" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.6  0 0 0 0 0.75  0 0 -3.6 0 1.62" result="lightSpecks" />
        <feComposite in="dark" in2="SourceAlpha" operator="in" result="d" />
        <feComposite in="lightSpecks" in2="SourceAlpha" operator="in" result="l" />
        <feComponentTransfer in="l" result="lf">
          <feFuncA type="linear" slope="0.22" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="d" />
          <feMergeNode in="lf" />
        </feMerge>
      </filter>
    </defs>
  )
}
