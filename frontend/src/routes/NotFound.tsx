import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { prefersReducedMotion } from '../styles/motion'
import { ButtonLink } from '../components/Button'
import { COPY } from '../lib/copy'
import { useKeeperScript } from '../keeper/store'
import { emit } from '../fx/events'

function Lantern() {
  const still = prefersReducedMotion()
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
      {/* warm pool on the misty path below */}
      <ellipse cx="60" cy="166" rx="56" ry="7" fill="#ff8a1f" opacity="0.14" />
      <motion.g
        style={{ originX: '60px', originY: '0px', transformBox: 'view-box' }}
        animate={still ? undefined : { rotate: [-6, 6, -6] }}
        transition={still ? undefined : { duration: 3.6, ease: [0.37, 0, 0.63, 1], repeat: Infinity }}
      >
        <circle cx="60" cy="100" r="95" fill="url(#nf-glow)" className="anim-ember" />
        <path d="M60 0V48" stroke="#4a4232" strokeWidth="2" />
        <circle cx="60" cy="40" r="6" fill="none" stroke="#4a4232" strokeWidth="2.4" />
        <path d="M38 62H82L74 48H46Z" fill="#1a150d" />
        <rect x="40" y="62" width="40" height="58" rx="5" fill="url(#nf-glass)" className="anim-ember" />
        <path d="M60 112C50 102 52 90 60 76C68 90 70 102 60 112Z" fill="#fff1c9" className="anim-flame" />
        <g stroke="#1a150d" strokeWidth="3" fill="none">
          <rect x="40" y="62" width="40" height="58" rx="5" />
          <path d="M53 62V120M67 62V120" strokeWidth="1.6" />
        </g>
        <path d="M36 120H84L78 130H42Z" fill="#1a150d" />
        <path d="M80 64V118" stroke="#c9d4ec" strokeOpacity="0.35" strokeWidth="1" />
      </motion.g>
    </svg>
  )
}

/** A pale path vanishing into mist beneath the lantern. */
function MistyPath() {
  return (
    <svg viewBox="0 0 240 40" className="mx-auto -mt-3 h-10 w-60" aria-hidden="true">
      <defs>
        <linearGradient id="nf-path" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#8fa3c7" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="nf-mist">
          <stop offset="0%" stopColor="#8fa3c7" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#8fa3c7" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M70 40C96 28 112 14 118 0H122C128 14 144 28 170 40Z" fill="url(#nf-path)" />
      <ellipse cx="60" cy="26" rx="70" ry="10" fill="url(#nf-mist)" />
      <ellipse cx="180" cy="30" rx="70" ry="9" fill="url(#nf-mist)" />
    </svg>
  )
}

export function NotFound() {
  useKeeperScript('guiding', [{ mood: 'guiding', anchor: 'home-path', focus: 'home' }])
  useEffect(() => {
    emit('lost')
  }, [])
  useEffect(() => {
    document.title = 'Lost · Resurrect'
    return () => {
      document.title = 'Resurrect'
    }
  }, [])
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 pb-[16vh] pt-16 text-center">
      <div data-keeper-anchor="home-path" className="mist-glass w-full rounded-2xl px-6 py-8 sm:px-10">
        <Lantern />
        <MistyPath />
        <h1 className="mt-4 font-display text-3xl font-bold text-moon sm:text-4xl">{COPY.notFound}</h1>
        <p className="mt-3 text-mist">There is nothing buried at this address. The link may be mistyped, or the page never existed.</p>
        <div className="mt-6" data-keeper-focus="home">
          <ButtonLink to="/" variant="primary">
            Follow the lantern home
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}
