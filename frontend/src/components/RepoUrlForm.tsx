import type { CreateResurrectionRequest } from '@contracts/types'
import { useId, useRef, useState, type FormEvent } from 'react'
import { emitFrom } from '../fx/particles'
import { keeperSignal } from '../keeper/keeperSignal'
import { emit } from '../fx/events'
import { buttonClass } from './Button'
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [flare, setFlare] = useState(false)
  const lastKey = useRef(0)
  const onKey = () => {
    keeperSignal.flare()
    const now = performance.now()
    if (now - lastKey.current > 150) {
      lastKey.current = now
      emit('keystroke')
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const parsed = parseRepoUrl(value)
    if (!parsed) {
      setInvalid(true)
      return
    }
    emitFrom(buttonRef.current, 'ember', { count: 30 })
    setFlare(true)
    window.setTimeout(() => setFlare(false), 450)
    onSubmit({ repo_url: parsed.url })
  }

  return (
    <form noValidate onSubmit={handleSubmit} data-keeper-anchor="url-input" className="mist-glass w-full rounded-2xl p-3 text-left sm:p-4">
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
          onFocus={() => keeperSignal.focus(true)}
          onBlur={() => keeperSignal.focus(false)}
          onKeyDown={onKey}
          onChange={(e) => {
            setValue(e.target.value)
            if (invalid) setInvalid(false)
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="min-w-0 flex-1 rounded-xl border border-moon/15 bg-night-950/70 px-4 py-3 text-base text-moon placeholder:text-mist/80 outline-none transition-[border-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-ember-300/70 focus:shadow-[0_0_0_1px_rgba(255,179,92,0.25),0_0_18px_rgba(255,138,31,0.28),inset_0_0_12px_rgba(255,138,31,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-300/60 aria-[invalid=true]:border-ember-500"
        />
        <button
          ref={buttonRef}
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={buttonClass(
            'primary',
            'shrink-0 px-6 disabled:opacity-80',
          )}
          style={
            flare
              ? { boxShadow: '0 0 20px rgba(255,241,201,0.6), 0 0 64px rgba(255,138,31,0.6)', filter: 'brightness(1.15)' }
              : undefined
          }
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
