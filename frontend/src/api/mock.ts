/**
 * Mock API. Replays contracts/mock-scenarios.json in real time so every screen
 * works without the backend. Same surface as the HTTP client.
 *
 * - The scenario is picked by its "match" substrings in the repo URL (default: alive).
 * - Every timestamp is shifted so the story starts when the ritual starts; server_time = now.
 * - Runs are kept in localStorage so /r/:id survives a reload (in-memory fallback).
 */
import type {
  ApiError,
  ErrorCode,
  LogLine,
  LogsResponse,
  Resurrection,
  ResurrectionStatus,
} from '@contracts/types'
import rawScenarios from '@contracts/mock-scenarios.json'
import { parseRepoUrl } from '../lib/repoUrl'
import { ApiRequestError } from './errors'
import type { ResurrectApi } from './types'

// ---------- scenario file shape ----------
type Frame = { at_ms: number; patch: Partial<Resurrection>; log_lines: LogLine[] }
type StoryScenario = { match: string[]; base: Resurrection; frames: Frame[]; retry_scenario?: string }
type ErrorScenario = { match: string[]; error: { status: number; body: ApiError } }
type Scenario = StoryScenario | ErrorScenario
type ScenarioFile = { scenarios: Record<string, Scenario> }

const FILE = rawScenarios as unknown as ScenarioFile
const SCENARIOS = FILE.scenarios
const isStory = (s: Scenario): s is StoryScenario => 'base' in s && 'frames' in s

const DEFAULT_SCENARIO = 'alive'

const LIFETIME_S = (() => {
  const n = Number(import.meta.env.VITE_MOCK_LIFETIME_S)
  return Number.isFinite(n) && n > 0 ? n : 1200
})()

/**
 * Mock-only triggers for the Turned away screens and the pinned state, which the
 * contract scenarios don't cover. Checked before the contract scenarios.
 */
const EXTRA_ERRORS: { match: string; status: number; code: ErrorCode; message: string; retry_after_s?: number }[] = [
  { match: 'mock-missing', status: 404, code: 'repo_not_found', message: 'GitHub says this repository does not exist or is private.' },
  { match: 'mock-heavy', status: 422, code: 'repo_too_large', message: 'The repository is 340 MB; the limit is 100 MB.' },
  { match: 'mock-quota', status: 429, code: 'quota_exhausted', message: 'The daily resurrection quota has been used up.', retry_after_s: 21600 },
  { match: 'mock-paused', status: 503, code: 'resurrections_disabled', message: 'Resurrections are switched off for now.' },
]
const PINNED_MATCH = 'eternal'

// ---------- persisted runs ----------
type Run = {
  id: string
  scenario: string
  /** epoch ms the current attempt started */
  started_ms: number
  /** epoch ms the first attempt started (record created_at) */
  created_ms: number
  attempt: number
  pinned: boolean
  repo: { owner: string; name: string; url: string }
  /** log lines from earlier attempts, so the cursor keeps counting up across a retry */
  prior_lines: LogLine[]
}

const STORE_KEY = 'resurrect.mock.runs'
let memory: Record<string, Run> = {}

function loadRuns(): Record<string, Run> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw) memory = { ...JSON.parse(raw), ...memory }
  } catch {
    /* storage unavailable: memory only */
  }
  return memory
}

function saveRun(run: Run) {
  const runs = loadRuns()
  runs[run.id] = run
  memory = runs
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(runs))
  } catch {
    /* ignore */
  }
}

// ---------- helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const latency = (min: number, max: number) => sleep(min + Math.random() * (max - min))
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const ACTIVE: ResurrectionStatus[] = ['summoning', 'building', 'checking_pulse']

function newId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'r-'
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function pickScenario(repoUrl: string): string {
  const url = repoUrl.toLowerCase()
  for (const [key, s] of Object.entries(SCENARIOS)) {
    if (s.match.some((m) => m && url.includes(m.toLowerCase()))) return key
  }
  return DEFAULT_SCENARIO
}

function story(key: string): StoryScenario {
  const s = SCENARIOS[key]
  if (!s || !isStory(s)) throw new Error(`mock scenario "${key}" has no story`)
  return s
}

const shiftIso = (value: string | null | undefined, offset: number) =>
  value ? iso(Date.parse(value) + offset) : (value ?? null)

/** Replace the scenario's own id and repo name with this run's, everywhere they appear in text. */
function rewriter(s: StoryScenario, run: Run) {
  const pairs: [string, string][] = [
    [s.base.id, run.id],
    [s.base.repo.name, run.repo.name],
  ]
  return (text: string) => pairs.reduce((t, [from, to]) => (from === to ? t : t.split(from).join(to)), text)
}

/** Builds the record and the full log as of `now` for a run. */
function replay(run: Run, now: number): { record: Resurrection; lines: LogLine[] } {
  const s = story(run.scenario)
  const offset = run.started_ms - Date.parse(s.base.created_at)
  const rw = rewriter(s, run)
  const elapsed = now - run.started_ms

  let rec: Resurrection = structuredClone(s.base)
  const lines: LogLine[] = [...run.prior_lines]
  for (const f of s.frames) {
    if (f.at_ms > elapsed) break
    rec = { ...rec, ...structuredClone(f.patch) }
    for (const l of f.log_lines) lines.push({ ...l, ts: shiftIso(l.ts, offset) ?? l.ts, text: rw(l.text) })
  }

  rec.id = run.id
  rec.repo = { ...rec.repo, owner: run.repo.owner, name: run.repo.name, url: run.repo.url }
  rec.attempt = run.attempt
  rec.pinned = run.pinned
  rec.created_at = iso(run.created_ms)
  rec.alive_at = shiftIso(rec.alive_at, offset)
  rec.expires_at = shiftIso(rec.expires_at, offset)
  if (rec.live_url) rec.live_url = rw(rec.live_url)
  if (rec.badge_markdown) rec.badge_markdown = rw(rec.badge_markdown)

  if (rec.status === 'alive') {
    if (run.pinned) {
      rec.expires_at = null
    } else if (rec.alive_at) {
      const expires = Date.parse(rec.alive_at) + LIFETIME_S * 1000
      rec.expires_at = iso(expires)
      if (now >= expires) {
        rec.status = 'expired'
        rec.phase_message = 'Returned to the grave'
        lines.push({ ts: iso(expires), text: 'Lifetime over. The files were laid to rest.', kind: 'system' })
      }
    }
  }
  rec.server_time = iso(now)
  return { record: rec, lines }
}

function getRun(id: string): Run {
  const run = loadRuns()[id]
  if (!run) throw new ApiRequestError(404, 'not_found', 'No resurrection with that id.')
  return run
}

function throwScenarioError(s: ErrorScenario): never {
  const e = s.error.body.error
  throw new ApiRequestError(s.error.status, e.code, e.message, e.retry_after_s)
}

// ---------- the API ----------
async function createResurrection(repoUrl: string): Promise<Resurrection> {
  await latency(700, 1200) // the autopsy takes a moment
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new ApiRequestError(400, 'invalid_url', 'repo_url must be a https://github.com/owner/repo link.')

  const lower = parsed.url.toLowerCase()
  const extra = EXTRA_ERRORS.find((x) => lower.includes(x.match))
  if (extra) throw new ApiRequestError(extra.status, extra.code, extra.message, extra.retry_after_s ?? null)

  const key = pickScenario(parsed.url)
  const s = SCENARIOS[key]
  if (!isStory(s)) throwScenarioError(s)

  const now = Date.now()
  const run: Run = {
    id: newId(),
    scenario: key,
    started_ms: now,
    created_ms: now,
    attempt: 1,
    pinned: lower.includes(PINNED_MATCH),
    repo: parsed,
    prior_lines: [],
  }
  saveRun(run)
  return replay(run, now).record
}

async function getResurrection(id: string): Promise<Resurrection> {
  await latency(120, 320)
  return replay(getRun(id), Date.now()).record
}

async function getLogs(id: string, cursor: string | null): Promise<LogsResponse> {
  await latency(120, 320)
  const { record, lines } = replay(getRun(id), Date.now())
  const from = cursor == null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0)
  const fresh = lines.slice(from)
  const terminal = !ACTIVE.includes(record.status)
  return { lines: fresh, cursor: String(lines.length), done: terminal }
}

async function retryResurrection(id: string): Promise<Resurrection> {
  await latency(500, 900)
  const run = getRun(id)
  const now = Date.now()
  const { record, lines } = replay(run, now)
  if (record.status !== 'failed') {
    throw new ApiRequestError(409, 'not_retryable', 'Only a failed resurrection can be retried.')
  }
  const next = story(run.scenario).retry_scenario ?? run.scenario
  const updated: Run = {
    ...run,
    scenario: next,
    started_ms: now,
    attempt: run.attempt + 1,
    prior_lines: [
      ...lines,
      { ts: iso(now), text: `Attempt ${run.attempt + 1}: re-running the autopsy at the latest commit`, kind: 'system' },
    ],
  }
  saveRun(updated)
  return replay(updated, now).record
}

/** No backend, so the badge is drawn here as a data URI. */
function badgeUrl(id: string): string {
  let status = 'unknown'
  try {
    status = replay(getRun(id), Date.now()).record.status.replace('_', ' ')
  } catch {
    /* unknown */
  }
  const right = status === 'alive' ? '#2a9d8f' : status === 'failed' ? '#c2410c' : '#555b6e'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20" role="img" aria-label="Resurrected: ${status}">` +
    `<rect width="88" height="20" rx="3" fill="#161a33"/><rect x="85" width="65" height="20" rx="3" fill="${right}"/>` +
    `<rect x="85" width="6" height="20" fill="${right}"/>` +
    `<g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" fill="#fff">` +
    `<text x="8" y="14">Resurrected</text><text x="94" y="14">${status}</text></g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const mockApi: ResurrectApi = { createResurrection, getResurrection, getLogs, retryResurrection, badgeUrl }
