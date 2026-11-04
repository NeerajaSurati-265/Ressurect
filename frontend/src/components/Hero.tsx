import type { CreateResurrectionRequest } from '@contracts/types'
import type { ReactNode } from 'react'
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
  return (
    <section className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-center px-4 pb-[24vh] pt-12 text-center sm:pb-[26vh]">
      <h1 className="wordmark text-[clamp(2.5rem,10vw,6.5rem)] font-bold leading-none tracking-[0.1em] text-ember-300">
        RESURRECT
      </h1>
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
    </section>
  )
}
