import type { CreateResurrectionRequest } from '@contracts/types'
import { m } from 'framer-motion'
import type { ReactNode } from 'react'
import { intro } from '../scene/intro'
import { useIntroHeld, useIntroPlaying } from '../scene/useIntro'
import { EASE_OUT_EXPO, SPRING } from '../styles/motion'
import { RepoUrlForm } from './RepoUrlForm'

export function Hero({
  onSubmit,
  busy = false,
  children,
  below,
}: {
  onSubmit: (req: CreateResurrectionRequest) => void
  busy?: boolean
  children?: ReactNode
  below?: ReactNode
}) {
  const playing = useIntroPlaying()
  // behind the entry gate the letters wait, hidden, until the lantern reveal is over
  const held = useIntroHeld()
  const fromIntro = intro.played
  return (
    <section className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-center px-4 pb-[24vh] pt-28 sm:pt-12 text-center sm:pb-[26vh]">
      <h1
        aria-label="RESURRECT"
        className="text-[clamp(2.5rem,10vw,6.5rem)] font-bold leading-none tracking-[0.1em] text-ember-300"
      >
        {fromIntro ? (
          // Letters rise one by one like carved stone; the ember inside ignites as each settles.
          <span aria-hidden="true" className="inline-flex">
            {LETTERS.map((ch, i) => (
              <m.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: '0.45em', filter: 'brightness(0.2)' }}
                animate={
                  held
                    ? { opacity: 0, y: '0.45em', filter: 'brightness(0.2)' }
                    : { opacity: 1, y: 0, filter: ['brightness(0.2)', 'brightness(0.45)', 'brightness(1.4)', 'brightness(1)'] }
                }
                transition={
                  playing
                    ? {
                        delay: 0.45 + i * 0.07,
                        y: { ...SPRING.heavy, delay: 0.45 + i * 0.07 },
                        opacity: { duration: 0.35, ease: EASE_OUT_EXPO, delay: 0.45 + i * 0.07 },
                        filter: { duration: 0.9, times: [0, 0.35, 0.7, 1], ease: 'easeOut', delay: 0.5 + i * 0.07 },
                      }
                    : { duration: 0.2, ease: EASE_OUT_EXPO }
                }
              >
                <span className="wordmark">{ch}</span>
              </m.span>
            ))}
          </span>
        ) : (
          <span className="wordmark">RESURRECT</span>
        )}
      </h1>
      <m.div
        className="flex w-full flex-col items-center"
        initial={fromIntro ? { opacity: 0, y: 12 } : false}
        animate={held ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
        transition={playing ? { duration: 0.6, ease: EASE_OUT_EXPO, delay: 1.25 } : { duration: 0.25, ease: EASE_OUT_EXPO }}
      >
      <p className="mt-6 font-display text-[clamp(1.25rem,4.2vw,1.875rem)] font-semibold text-moon">
        Bring your dead repos back to life.
      </p>
      <p className="mt-3 max-w-xl text-base text-mist sm:text-lg">
        Paste a public GitHub repo. We'll perform the autopsy, hold the séance and raise it from the grave, live for 20
        minutes.
      </p>
      <div className="mt-10 w-full">
        {children ?? <RepoUrlForm onSubmit={onSubmit} busy={busy} />}
      </div>
      {below}
      </m.div>
    </section>
  )
}

const LETTERS = 'RESURRECT'.split('')
