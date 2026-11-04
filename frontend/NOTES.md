# Frontend notes

## Morning summary (2026-11-04)

**Nothing is committed or pushed.** Your global `~/.claude/settings.json` denies `git add`, `git commit`
and `git push`, so I couldn't make the per-phase commits. All work is in the working tree. To commit
everything (from the repo root):

    git add frontend README.md && git commit -m "feat(frontend): api client, mock, flow screens, graveyard, deploy script, polish" && git push

You can also split it into the five planned commits. Phase 1 = `src/api`, env files. Phase 2 = `src/hooks`,
`App.tsx`, `Layout.tsx`, `Landing.tsx`. Phase 3 = `src/resurrection`, `TurnedAway`, `CopyField`, `Button`.
Phase 4 = `Graveyard`, `NotFound`, `rip/`, `lib/graveyard.ts`. Phase 5 = `deploy.sh`, `README.md`.
Phase 6 = scene/*, `index.css`, `Footer`, `FilmGrain`.

**Built:** all six phases: the typed API client and real-time mock, the polling hooks and routes, every
screen in the DESIGN.md table, the countdown with local expiry, the graveyard, the lantern 404,
`rip/index.html` (7 KB), `deploy.sh` and the README. The cinematic polish covers aerial depth, mist bands,
rim light, ember pools, a stronger moon halo, the vignette, film grain, the carved wordmark, unified glass
panels and the phone footer fix.

**Verified:**
- `npm run build` passes with zero TypeScript errors.
- The production bundle does not contain the mock.
- A headless Chrome smoke test (mock build, `VITE_MOCK_LIFETIME_S=60`) passed every scenario with no
  console errors:
  - alive: séance, pulse check, "It lives.", reload, expiry, "Resurrect again", graveyard shows 2.
  - ghost: Try again, then alive.
  - cannot_rise.
  - greedy: "Return in 30 minutes".
  - Unknown route and unknown id both show their 404 screens.
- On a 390 px phone the page has no horizontal scroll and the footer clears the tombstones.

**Skipped or not done (out of usage budget):**
- The FINAL CHECK screenshot set in `frontend/screenshots/` was not produced. `screenshots/` is already
  in `frontend/.gitignore`.
- Lighthouse was not run.
- `deploy.sh` was only syntax-checked (`bash -n`), never executed, as instructed.

**Please review:**
- The autopsy card is dark sepia "parchment" with bone text. Bone on the parchment token has about
  1.1:1 contrast, which is unreadable.
- On alive, failed and expired the autopsy findings start collapsed, so the result card stays near the
  top of the page.
- The mock creates fresh ids and uses your repo's owner/name.
- The mock has extra test triggers: `mock-missing`, `mock-heavy`, `mock-quota`, `mock-paused` and
  `eternal`.
- The impeccable design plugin created `/.impeccable/hook.cache.json` at the repo root. That is outside
  frontend/ and I did not touch it, so delete it or gitignore it. Its ignore config is in
  `frontend/.impeccable/`.
- SPA routes (`/r/:id`) need CloudFront to serve index.html for 403/404 on the UI distribution. That is
  infra work for Person B.
- A `vite preview` you started earlier is still on port 4173. Mine ran on 4319.


## Decisions made overnight

### Phase 1: API client and mock
- **Where `api` lives.** `src/api/client.ts` is the HTTP client, `src/api/mock.ts` is the mock, and
  `src/api/index.ts` exports the single `api` object (picked by `VITE_USE_MOCK`). Screens import only
  from `src/api`.
- **Network failures** (fetch throws) become `ApiRequestError {status: 0, code: "internal"}`, so every
  screen handles one error shape. A non-JSON error body becomes `internal` (or `not_found` for 404).
- **Admin header** is sent on `POST /resurrections` and `POST /resurrections/{id}/retry` only, read from
  `localStorage["resurrect.admin"]` inside try/catch.
- **Mock ids are fresh per ritual** (`r-` + 6 random chars) instead of reusing the scenario's fixed id,
  so two rituals of the same scenario don't overwrite each other in the graveyard. The scenario id is
  rewritten to the new id everywhere it appears (live_url, badge_markdown, log lines).
- **Mock uses your repo's owner/name** instead of the scenario's `you/todo-of-the-dead`, so the
  tombstone shows the repo you pasted. The scenario repo name is also rewritten in log lines.
- **Mock runs persist in localStorage** (`resurrect.mock.runs`) so `/r/:id` keeps replaying after a
  reload; falls back to memory if storage is blocked.
- **Mock retry keeps the log cursor counting up.** Lines from the failed attempt stay in the log and a
  system line "Attempt 2: re-running the autopsy…" is added, so a numeric cursor never goes backwards.
- **Mock expiry.** When an alive run passes `expires_at` the mock reports `status: "expired"`
  (live_url kept). `expires_at = alive_at + VITE_MOCK_LIFETIME_S` (default 1200).
- **Mock badge** is an inline SVG data URI (there is no badge endpoint without the backend).
- **Mock-only triggers** (not in the contract, added for testing the screens the contract scenarios
  don't reach): repo URL containing `mock-missing` → 404 repo_not_found, `mock-heavy` → 422
  repo_too_large, `mock-quota` → 429 quota_exhausted, `mock-paused` → 503 resurrections_disabled,
  `eternal` → alive story with `pinned: true` (shows "Eternal").
- **mock-scenarios.json vs types.ts:** no field mismatches found. The only differences are structural:
  the 429 scenario is keyed `rate_limited` and has an `error` block instead of `base`/`frames`, and
  `ghost` has an extra `retry_scenario`. The mock types these locally; contracts/ is untouched.
- **Matching is substring-based as the contract says**, so a repo named e.g. `rapid-notes` contains
  "api" and replays cannot_rise. That is contract behaviour, kept on purpose.
- **Env files.** The root `.gitignore` (frozen) ignores `.env*`; `frontend/.gitignore` re-includes
  `.env.example` and `.env.development`, which hold no secrets.
- Added `resolveJsonModule` to `tsconfig.app.json` so the mock can import the scenarios JSON.

### Phases 2–6
- Retry keeps the same log stream; the séance shows earlier attempts' lines (typing is skipped when 20+ are queued).
- Alive records past `expires_at` (server clock) are shown as expired immediately, then refetched once.
- Expired screen shows the dimmed Risen card below "Rest in peace" only if you watched it alive this visit.
- The hero fills the first screen; the graveyard is below it, with a "Your graveyard · N" jump link when not empty.
- Moss green `#6b8455` is used for expired graves (not a DESIGN.md token).
