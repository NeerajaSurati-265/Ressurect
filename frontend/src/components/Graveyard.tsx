import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, toApiRequestError } from '../api'
import { COPY } from '../lib/copy'
import { markLost, rememberResurrection, useGraveyard, type GraveRecord, type GraveStatus } from '../lib/graveyard'
import { formatClock, msUntil, useNow } from '../lib/time'

type Look = 'alive' | 'failed' | 'grey' | 'moss' | 'rising' | 'lost'

function lookOf(status: GraveStatus): Look {
  switch (status) {
    case 'alive':
      return 'alive'
    case 'failed':
      return 'failed'
    case 'cannot_rise':
      return 'grey'
    case 'expired':
      return 'moss'
    case 'lost':
      return 'lost'
    default:
      return 'rising'
  }
}

const LABEL: Record<Look, string> = {
  alive: 'Alive',
  failed: 'Failed',
  grey: 'Cannot rise',
  moss: 'Expired',
  rising: 'Rising…',
  lost: 'Lost to the ages',
}

const STONE_FILL: Record<Look, [string, string]> = {
  alive: ['#5a6488', '#1e2238'],
  failed: ['#4d5478', '#1a1d31'],
  grey: ['#55575e', '#25262b'],
  moss: ['#4c5a5a', '#1c2224'],
  rising: ['#525b80', '#1c2036'],
  lost: ['#2f3346', '#14161f'],
}

function MiniStone({ grave, look }: { grave: GraveRecord; look: Look }) {
  const name = grave.name.length > 14 ? `${grave.name.slice(0, 13)}…` : grave.name
  const size = Math.min(13, 118 / Math.max(6, name.length))
  const [top, bottom] = STONE_FILL[look]
  const gid = `gy-${grave.id}`
  return (
    <svg viewBox="0 0 100 120" className="block h-auto w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="100%" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={`${gid}-glow`}>
          <stop offset="0%" stopColor={look === 'alive' ? '#7de2d1' : '#ff8a1f'} stopOpacity="0.55" />
          <stop offset="100%" stopColor={look === 'alive' ? '#7de2d1' : '#ff8a1f'} stopOpacity="0" />
        </radialGradient>
      </defs>
      {(look === 'alive' || look === 'rising') && (
        <ellipse cx="50" cy="62" rx="54" ry="60" fill={`url(#${gid}-glow)`} className={look === 'rising' ? 'anim-ember' : 'anim-pulse-soft'} />
      )}
      {look === 'failed' && (
        // an ember wisp drifting off the stone
        <g className="anim-wisp">
          <path d="M66 22C60 14 70 8 64 0C74 6 76 16 70 24C68 27 66 25 66 22Z" fill="#ff8a1f" fillOpacity="0.8" />
          <circle cx="67" cy="22" r="7" fill="url(#gy-wisp)" />
        </g>
      )}
      <defs>
        <radialGradient id="gy-wisp">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M18 112V52A32 32 0 0 1 82 52V112Z"
        fill={`url(#${gid})`}
        stroke={look === 'alive' ? '#7de2d1' : '#0b0d19'}
        strokeOpacity={look === 'alive' ? 0.7 : 1}
        strokeWidth="1.5"
        opacity={look === 'lost' ? 0.55 : 1}
      />
      <path d="M20 100V52A30 30 0 0 1 64 25" fill="none" stroke="#c9d4ec" strokeOpacity="0.22" strokeWidth="1.2" />
      <text
        x="50"
        y="70"
        textAnchor="middle"
        fontFamily="Cinzel, serif"
        fontWeight="700"
        fontSize={size}
        fill="#0b0d19"
        opacity={look === 'lost' ? 0.6 : 0.95}
      >
        {name.toUpperCase()}
      </text>
      <path d="M36 82H64M40 90H60" stroke="#0b0d19" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
      {look === 'moss' && (
        <g fill="#6b8455" fillOpacity="0.85">
          <ellipse cx="28" cy="110" rx="12" ry="4" />
          <ellipse cx="72" cy="111" rx="14" ry="3.5" />
          <ellipse cx="21" cy="100" rx="3.5" ry="7" />
        </g>
      )}
      {look === 'grey' && <path d="M60 40L54 58L62 68L55 84" fill="none" stroke="#0b0d19" strokeWidth="1.6" />}
      <path d="M4 114C30 108 70 108 96 114C70 119 30 119 4 114Z" fill="#05060b" />
    </svg>
  )
}

function GraveCard({ grave, offset, now }: { grave: GraveRecord; offset: number; now: number }) {
  let status = grave.status
  const left = grave.expires_at ? msUntil(grave.expires_at, offset, now) : Infinity
  if (status === 'alive' && !grave.pinned && left <= 0) status = 'expired'
  const look = lookOf(status)
  const detail =
    look === 'alive' ? (grave.pinned || !grave.expires_at ? 'Eternal' : `${formatClock(left)} left`) : LABEL[look]

  return (
    <li>
      <Link
        to={`/r/${grave.id}`}
        className="group flex flex-col items-center rounded-xl p-2 text-center transition-colors hover:bg-moon/5"
        aria-label={`${grave.owner}/${grave.name}: ${look === 'alive' ? `alive, ${detail}` : LABEL[look]}`}
      >
        <div className="w-20 transition-transform group-hover:-translate-y-1 sm:w-24">
          <MiniStone grave={grave} look={look} />
        </div>
        <span className="mt-2 w-full truncate text-sm font-semibold text-moon">{grave.name}</span>
        <span
          className={`text-xs ${look === 'alive' ? 'font-display font-bold tabular-nums text-spectral' : look === 'failed' ? 'text-ember-300' : look === 'moss' ? 'text-[#9bb582]' : 'text-mist'}`}
        >
          {detail}
        </span>
      </Link>
    </li>
  )
}

/** "Your graveyard": recent resurrections kept in this browser. */
export function Graveyard() {
  const graves = useGraveyard()
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const anyAlive = graves.some((g) => g.status === 'alive' && g.expires_at)
  const now = useNow(1000, anyAlive)

  // On mount, refresh each record from the API, 300 ms apart. A 404 means it is gone.
  useEffect(() => {
    const ids = graves.filter((g) => g.status !== 'lost').map((g) => g.id)
    let cancelled = false
    const timers = ids.map((id, i) =>
      window.setTimeout(async () => {
        try {
          const r = await api.getResurrection(id)
          if (cancelled) return
          rememberResurrection(r)
          setOffsets((o) => ({ ...o, [id]: Date.parse(r.server_time) - Date.now() }))
        } catch (e) {
          if (cancelled) return
          const err = toApiRequestError(e)
          if (err.status === 404 || err.code === 'not_found') markLost(id)
        }
      }, i * 300),
    )
    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
    // run once per visit to the landing page
  }, [])

  return (
    <section aria-labelledby="graveyard-h" className="mx-auto w-full max-w-3xl px-4 pb-16">
      <div className="mist-glass rounded-2xl p-5 sm:p-6">
        <h2 id="graveyard-h" className="font-display text-xl font-bold text-moon sm:text-2xl">
          Your graveyard
        </h2>
        {graves.length === 0 ? (
          <p className="mt-2 text-mist">{COPY.emptyGraveyard}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-mist">Your recent resurrections in this browser. Open one to see its state.</p>
            <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {graves.map((g) => (
                <GraveCard key={g.id} grave={g} offset={offsets[g.id] ?? 0} now={now} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
