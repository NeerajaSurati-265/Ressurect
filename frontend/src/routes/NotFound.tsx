import { useEffect } from 'react'
import { ButtonLink } from '../components/Button'
import { COPY } from '../lib/copy'

function Lantern() {
  return (
    <svg viewBox="0 0 120 170" className="mx-auto h-40 w-28 overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id="nf-glow">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#ff8a1f" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nf-glass" cx="50%" cy="60%" r="65%">
          <stop offset="0%" stopColor="#fff1c9" />
          <stop offset="45%" stopColor="#ffb35c" />
          <stop offset="100%" stopColor="#c55400" />
        </radialGradient>
      </defs>
      <g className="anim-sway" style={{ transformOrigin: '60px 0px' }}>
        <circle cx="60" cy="100" r="95" fill="url(#nf-glow)" className="anim-ember" />
        <path d="M60 0V34" stroke="#4a4232" strokeWidth="2" />
        <circle cx="60" cy="40" r="6" fill="none" stroke="#4a4232" strokeWidth="2.4" />
        <path d="M38 62H82L74 48H46Z" fill="#1a150d" />
        <rect x="40" y="62" width="40" height="58" rx="5" fill="url(#nf-glass)" className="anim-ember" />
        <path d="M60 112C50 102 52 90 60 76C68 90 70 102 60 112Z" fill="#fff1c9" className="anim-flame" />
        <g stroke="#1a150d" strokeWidth="3" fill="none">
          <rect x="40" y="62" width="40" height="58" rx="5" />
          <path d="M53 62V120M67 62V120" strokeWidth="1.6" />
        </g>
        <path d="M36 120H84L78 130H42Z" fill="#1a150d" />
      </g>
    </svg>
  )
}

export function NotFound() {
  useEffect(() => {
    document.title = 'Lost · Resurrect'
    return () => {
      document.title = 'Resurrect'
    }
  }, [])
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 pb-[16vh] pt-16 text-center">
      <div className="mist-glass w-full rounded-2xl px-6 py-8 sm:px-10">
        <Lantern />
        <h1 className="mt-4 font-display text-3xl font-bold text-moon sm:text-4xl">{COPY.notFound}</h1>
        <p className="mt-3 text-mist">There is nothing buried at this address. The link may be mistyped, or the page never existed.</p>
        <div className="mt-6">
          <ButtonLink to="/" variant="primary">
            Follow the lantern home
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}
