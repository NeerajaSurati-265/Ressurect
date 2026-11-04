// A tiny tile of fractal noise, rasterised once by the browser and shifted in steps
// on the compositor. Hidden entirely with prefers-reduced-motion (see .film-grain in index.css).
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.9 0 0 0 0 0.92 0 0 0 0 0.96 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Very subtle animated film grain over the whole page. */
export function FilmGrain() {
  return (
    <div aria-hidden="true" className="film-grain">
      <div className="film-grain-tile" style={{ backgroundImage: NOISE }} />
    </div>
  )
}
