import type { Severity } from '@contracts/types'

/** ok = spectral check, warn = ember candle, block = blood X. */
export function SeverityIcon({ severity, className = 'h-6 w-6' }: { severity: Severity; className?: string }) {
  if (severity === 'ok') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#7de2d1" fillOpacity="0.14" stroke="#7de2d1" strokeOpacity="0.55" />
        <path d="M7 12.5l3.2 3.2L17.5 8" fill="none" stroke="#7de2d1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (severity === 'warn') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="9" r="7" fill="#ff8a1f" fillOpacity="0.16" className="anim-ember" />
        <path d="M12 3.5c1.8 2.2 2.2 3.8 0 6.2-2.2-2.4-1.8-4 0-6.2z" fill="#ffb35c" className="anim-flame" />
        <rect x="9" y="11" width="6" height="9" rx="1" fill="#e8e1d0" />
        <path d="M7 20.5h10" stroke="#e8e1d0" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#e5484d" fillOpacity="0.16" stroke="#e5484d" strokeOpacity="0.6" />
      <path d="M8 8l8 8M16 8l-8 8" stroke="#ff6b70" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export const SEVERITY_LABEL: Record<Severity, string> = { ok: 'OK', warn: 'Warning', block: 'Blocking' }

export function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

export function Candle({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 40 90" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="candle-glow">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.55" />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="candle-wax" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f3ecdb" />
          <stop offset="60%" stopColor="#d9c9a3" />
          <stop offset="100%" stopColor="#9c8a64" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="22" r="20" fill="url(#candle-glow)" className="anim-ember" style={{ animationDelay: `${delay}s` }} />
      <path
        d="M20 8c4 5 5 9 0 15-5-6-4-10 0-15z"
        fill="#ffb35c"
        className="anim-flame"
        style={{ animationDelay: `${delay}s` }}
      />
      <path d="M20 13c2 3 2.2 5 0 8-2.2-3-2-5 0-8z" fill="#fff1c9" className="anim-flame" style={{ animationDelay: `${delay}s` }} />
      <path d="M20 23v4" stroke="#2a2418" strokeWidth="1.4" />
      <path d="M12 28h16v54H12z" fill="url(#candle-wax)" />
      <path d="M12 28c2 0 3 6 5 6s2-6 4-6 3 9 5 9 2-9 2-9" fill="#f3ecdb" />
      <path d="M6 84h28" stroke="#2a2418" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
