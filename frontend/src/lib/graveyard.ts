import type { Resurrection, ResurrectionStatus } from '@contracts/types'
import { useSyncExternalStore } from 'react'

export type GraveStatus = ResurrectionStatus | 'lost'

export type GraveRecord = {
  id: string
  owner: string
  name: string
  repo_url: string
  created_at: string
  status: GraveStatus
  expires_at: string | null
  pinned: boolean
}

const KEY = 'resurrect.graveyard'
const MAX = 12

let cache: GraveRecord[] | null = null
const listeners = new Set<() => void>()

function read(): GraveRecord[] {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? (parsed.filter((r) => r && typeof r.id === 'string') as GraveRecord[]) : []
  } catch {
    cache = []
  }
  return cache
}

function write(list: GraveRecord[]) {
  cache = [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage blocked: keep the in-memory copy for this visit */
  }
  listeners.forEach((l) => l())
}

export function toGrave(r: Resurrection): GraveRecord {
  return {
    id: r.id,
    owner: r.repo.owner,
    name: r.repo.name,
    repo_url: r.repo.url,
    created_at: r.created_at,
    status: r.status,
    expires_at: r.expires_at,
    pinned: r.pinned,
  }
}

/** Insert or update a record from a fresh API response. */
export function rememberResurrection(r: Resurrection) {
  const next = toGrave(r)
  const list = read()
  const prev = list.find((g) => g.id === r.id)
  if (
    prev &&
    prev.status === next.status &&
    prev.expires_at === next.expires_at &&
    prev.name === next.name &&
    prev.pinned === next.pinned
  )
    return
  write([next, ...list.filter((g) => g.id !== r.id)])
}

export function markLost(id: string) {
  const list = read()
  if (!list.some((g) => g.id === id && g.status !== 'lost')) return
  write(list.map((g) => (g.id === id ? { ...g, status: 'lost' as const } : g)))
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

const EMPTY: GraveRecord[] = []

export function useGraveyard(): GraveRecord[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}
