import type { CreateResurrectionRequest } from '@contracts/types'
import { useId, useState, type FormEvent } from 'react'
import { INVALID_URL_COPY, parseRepoUrl } from '../lib/repoUrl'

export function RepoUrlForm({
  onSubmit,
  busy = false,
}: {
  onSubmit: (req: CreateResurrectionRequest) => void
  busy?: boolean
}) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const inputId = useId()
  const errorId = useId()

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const parsed = parseRepoUrl(value)
    if (!parsed) {
      setInvalid(true)
      return
    }
    onSubmit({ repo_url: parsed.url })
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mist-glass w-full rounded-2xl p-3 text-left sm:p-4">
      <label htmlFor={inputId} className="sr-only">
        Public GitHub repository URL
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://github.com/you/your-forgotten-project"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (invalid) setInvalid(false)
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="min-w-0 flex-1 rounded-xl border border-moon/15 bg-night-950/70 px-4 py-3 text-base text-moon placeholder:text-mist/80 focus:border-ember-500/70 aria-[invalid=true]:border-ember-500"
        />
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="shrink-0 cursor-pointer rounded-xl bg-ember-500 px-6 py-3 font-semibold text-night-950 shadow-[0_0_24px_rgba(255,138,31,0.35)] transition-[background-color] hover:bg-ember-300 disabled:cursor-wait disabled:opacity-80"
        >
          {busy ? 'Performing the autopsy…' : 'Begin the ritual'}
        </button>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="mt-3 px-1 text-sm text-ember-300">
          {INVALID_URL_COPY}
        </p>
      )}
    </form>
  )
}
