# Frontend notes

## Audio fix + entry gate (2026-11-05)

**Status:** `npm run build` passes and oxlint is clean on the changed files. Every change is inside `frontend/`,
with no new dependencies. Nothing is committed.

### Task 1: inaudible audio

**Diagnosis**
- The main cause was levels and register. The master was capped at 0.35 and the music bus sat at 0.5. The drone's
  fundamental was D1 (36 Hz) with D2 under a 200 Hz low-pass, which laptop speakers can't play at all. Each pad voice
  was 0.05 × 0.22 under a 650 Hz low-pass, about -45 dBFS. The heartbeat was 62→36 Hz.
- The gesture path was already correct (`createEngine()` + `resume()` run inside the click). It is now explicit:
  `resume()` is the first call in `startAudio()`. The state is logged once: `[resurrect] audio context created: …`
  and `… after gesture: running`.
- `theme.mp3` detection was already correct: `hasAsset(url, 'audio/')` requires `content-type` to start with `audio/`.
- `visibilitychange` could leave the context suspended. On return it called `resume()` without checking the result,
  never re-armed the gesture retry, and didn't clear a pending `stopAudio` suspend. It now does all three. A
  `statechange` hook also re-arms the retry if the context is suspended or `interrupted` (iOS) while sound is on.

**Changes**
- `score.ts`:
  - The drone is now D3 (147 Hz) triangle + saw and A3 (220 Hz) sine, through a 1.2 kHz low-pass so the harmonics
    come through. A quiet D2 sub (0.06) is kept as an extra only.
  - Pad fundamentals are now in MIDI 45–64 (110–330 Hz), with the low-pass at 1.6 kHz (ritual 2.2 kHz), voices at
    0.13 and the pad level at 0.45.
  - The heartbeat gained a 110→70 Hz partial and a 180 Hz knock.
  - The dissonant swell moved up an octave.
- `engine.ts`: the master now follows a volume pref (`volume^1.5`, default 0.6, which gives about 0.46). The music bus
  is at 0.85 and the limiter threshold at -6 dB.
- `prefs.ts`: `volume` is stored in localStorage `resurrect:volume`, inside try/catch.
- `SoundToggle`: a speaker button next to the lantern opens a popover with a 0–100 slider. It closes on Esc, on an
  outside click or on blur.
- `sfx.ts` `playChime()`: a soft 880 Hz bell plays when you switch sound on (toggle, or "Wake the music").
- Nothing autoplays: audio still starts only from a gesture.

**Check by ear (laptop speakers, system volume at 50%)**. I did not measure levels, as agreed. Listen for:
- At the default slider (60), the drone and pad should be clearly audible as a hum with chords changing every
  12–20 s, not just air. If it's too loud or harsh, lower `PAD_LEVEL` (0.45) or the 0.85 music bus first.
- The chime on "Summon the music" should be soft, not a ding that makes you jump.
- The heartbeat during the pulse check should be audible as a knock.
- The slider should run smoothly from silent (0) to loud (100) with no pumping at 100. If it pumps, raise the limiter
  threshold back toward -10 dB.
- The promo's voice-over vs. the music: the music should fade in under the reveal, not over the end of the video.

### Task 2: entry gate, promo, fog + lantern transition

**Assets**
- `public/intro/promo.mp4` was re-encoded with your command (CRF 27, 1920 wide, faststart, AAC 128k). It came out at
  **1.98 MB (1,982,920 bytes), 1920x1080, 15 s**, under the 5 MB target on the first pass.
- `public/intro/poster.jpg` is the re-encoded file's first frame, 1280x720, 11 KB.

**Flow**
- `src/gate/gateState.ts` decides once at load: the gate shows only on `/` with no sessionStorage
  `resurrect:gate-seen`. It never shows on `/r/:id` or the 404.
- `src/gate/EntryGate.tsx`:
  - A misty night screen with the wordmark, "Enter the graveyard" and "Enter in silence". The video preloads only
    after a `HEAD` confirms `content-type: video/*`, and not at all when `saveData` is on.
  - "Enter the graveyard" plays the promo with sound and calls `startAudio({ hold: true })` in the same click: the
    context starts, but the music stays silent until the reveal. "Enter in silence" plays it muted and turns music off.
  - Skip appears at 1 s; Esc also skips. The video jumps to the transition on `error`, if nothing plays within 3 s, if
    a stall lasts more than 3 s, or if `play()` is rejected. It retries muted once first if unmuted playback is refused.
- `src/gate/reveal.ts`: one half-resolution canvas.
  - 0–1 s: fbm fog rolls in while the video's volume fades.
  - At 1 s: `gate.release()` lets the Keeper place itself under the fog. Its lantern position is read from
    `--keeper-lx/ly`, falling back to the URL input, then to 50%/68%.
  - 1–2.4 s: a warm glow blooms and burns a widening opening with a wobbling, soft-edged rim, while the music fades
    in (`releaseMusic(1.4)`).
  - After the reveal, `intro.start()` makes the letters rise and the Keeper says its first line (`greet()`).
  - With reduced motion it's a 600 ms crossfade instead.
- `intro.ts` holds the letters intro behind the gate (no double intro). The Scene's own veil/moon intro is skipped in
  gate sessions. `dialogue.ts` suppresses the landing and idle lines while the gate is up.
- `deploy.sh`: `intro/*` is excluded from the no-cache sync and uploaded separately with
  `Cache-Control: public, max-age=86400`, using `video/mp4` for mp4 files and `image/jpeg` for jpg files. Only
  checked with `bash -n`; it was not run.

**Verified (headless Chrome 151 against a mock build, `vite preview`). All checks passed and there were no console
errors or exceptions:**
- The gate shows on the first `/` visit and not after a reload. It never shows on `/r/abc123` or `/nowhere/at/all`.
- "Enter in silence": the video plays muted, Skip is hidden and then shows after 1 s, Skip runs the transition, the
  gate is gone after it, the letters rise afterwards, and the music pref stays off.
- "Enter the graveyard": the video plays unmuted, the music pref is on, and the context is `running` after the click.
  Esc runs the transition.
- Phone (390x844): the button is 320x56, and the video fills the screen with `object-fit: cover`.
- Reduced motion: the crossfade finishes.
- With `promo.mp4` renamed (preview served `text/html`), the click goes straight to the transition. The file was
  restored afterwards.
- A canvas probe confirmed the reveal grows outward from the lantern: lantern point cleared first, centre
  half-open, corners last.

**Check by eye:**
- Headless ran at about 3 fps, so judge the fog and reveal smoothness in a real browser.
- Watch whether the opening's rim reads as smoky rather than as a wobbly circle.
- Under 640 px the Keeper is hidden, so the light opens from beside the URL input instead.

## Visual critique (STEP 0, 2026-11-04)

Fresh headless captures at 1440x900 and 390x844 are in `screenshots/before/`. This is the senior-designer read.
It lists the ten things that most make the site look amateur, worst first.

1. **Flat fills with no light direction.** Hills, stones, the Grave and the Keeper's robe are each one or two flat
   colours. Nothing is lit from the moon side, and nothing has texture, so the scene reads as vector clip art.
2. **The moon is clip art.** It is a grey disc with polka-dot craters and a cartoon cloud glued to its underside. It
   casts no light on the clouds, trees or stones, and the top of it is cropped on `/r/:id`.
3. **There is no atmospheric depth.** The hill silhouettes are hard, no fog volume sits between the layers, and the far
   and near layers are equally sharp, so it looks like stacked cut-outs. The séance's elliptical mist band reads as a
   flying saucer.
4. **The glow hierarchy is missing.** The wordmark, the button, the lantern and the pumpkins share one orange bloom,
   and the wordmark outshines the only real light source. The moon should be the brightest cold light and the flames
   the brightest warm light.
5. **The stones look printed, not carved.** They are uniform rounded rectangles with even outlines. The engraving is
   flat text, and the crack and moss look like stickers. The Risen light column is a hard-edged teal rectangle.
6. **The Keeper's whisper is illegible.** About 12 px, blurred and low contrast under the figure (see `séance`, `risen`
   and `ghost`). It looks like a rendering bug, not narration.
7. **The trees are uniform vector strokes.** They are a single 1 px weight with clean edges, no bark, no fine twigs and
   no movement. They are also repeated nearly identically across the width.
8. **The flames are single shapes.** The pumpkins, candles and lantern each use one path with an opacity flicker.
   No hot core and no light reaches nearby surfaces, and the pumpkin faces are cartoon.
9. **The ghost is a cartoon.** It is a soft, round sheet with two orange dots, and those are the same ember eyes as the
   Keeper's. It reads as a Halloween sticker, not a spirit.
10. **The edges are unfinished.** On `/r/:id` a hard dark seam crosses the top 36 px (the 60 px scene descent shows bare
    background). The foreground ground is empty and flat, the fence and stones are cropped at the bottom edge, and
    fireflies clump into a yellow blob mid-air.

Also noted, though not visual: the page is silent and the Keeper barely speaks, so the state changes land abruptly with
no narrative beat. The sound and dialogue agents cover this.

Owners: items 1-5 and 7-10 are the realism pass (Agent 3). Item 6 and the narration belong to the Keeper agent
(Agent 2). Item 10's top seam is the Scene descent (Agent 3).

## The Keeper as companion (2026-11-04)

- `src/keeper/`: `store.ts` (setKeeper / useKeeperScript / keeperEvent), `placement.ts` (pure solver),
  `Keeper.tsx` (one rAF loop writing transforms; art is rendered once), `keeperSignal.ts` (moved from scene/).
- Mounted once in `Layout` as `<KeeperLayer/>`: light layer at z-5 (under content, so glass catches it
  through its blur), figure at z-20 (under fog wipe/particles z-30, grain z-40). Hidden under 640 px.
- Screens mark `data-keeper-anchor` (url-input, grave, seance, result-card, ghost-card, cannot-rise,
  turned-away, home-path) and `data-keeper-focus` (visit, home). The choreography per status lives in
  `ResurrectionView.keeperSteps()`; Landing and NotFound set their own.
- Placement: beside the anchor on the roomier side, scanning vertical offsets and shrinking; falls back to
  the nearest free spot; if nothing is clear it dissolves. Obstacles = text, controls and glass panels
  inside `#main` and `footer`. During a flight that crosses content it fades out and only its smoke shows.
- Glass panels (>= 640 px) get a viewport-fixed warm wash at `--keeper-lx/--keeper-ly`, scaled by
  `--keeper-light` (written ~20 fps, only when the lantern moves).
- Pulse: `PulseCheck` computes when the pen tip crosses each R-peak (inverse of its keySpline) and fires
  `keeperEvent('beat')`; Séance fires `'line'` with the candle flare.
- Not checked: the 25 s idle wander (needs a clear strip below the hero; it skips itself otherwise), and
  1024-1279 px widths where gutters are narrow (it should fall back to the aside column or dissolve).

## UI/UX upgrade summary (2026-11-04, 11:00–11:20 IST)

**Status:** `npm run build` passes. Nothing is committed. Every change is inside `frontend/` and there are no new
dependencies. `rip/index.html` is 8.3 KB.

**What changed**
- Foundation: `src/fx/particles.ts` and `<ParticleLayer/>` are one pooled canvas engine, `emit(preset, {x, y, count})`,
  with the presets ember, spirit-mote, dirt, smoke and firefly. It is capped at about 60 fps, sleeps when empty,
  pauses on a hidden tab and is off under reduced motion. Also new: `src/styles/motion.ts` (easings, durations,
  springs, `float()`) and `src/styles/surfaces.css` (glow tokens, vignette, `.card-rise`, `.ink-in`).
- Rituals: the tombstone sinks, then heaves up with dirt and a small camera shake. Risen: two shudders, a glowing crack,
  the halves fall, a light column rises, about 50 spirit motes come out and the card rises. The ghost gathers out of
  smoke, its eyes open last and it floats with a wisp. The copy buttons show a check mark and an ember pulse.
- Landing: a 1.6 s intro once per session, skippable (moon out of cloud, fog, the letters rise and ignite).
  The Keeper's lantern and eyes react to input focus and keystrokes. Pale wisps and pumpkin embers drift in the scene
  SVG, and a cloud crosses the moon every 15–25 s. The button gets a hover shimmer, sinks when pressed and bursts
  embers on submit. The input gets a candlelight focus glow.
- Séance: log lines bleed in like ink, the candles flare on new lines, and the phase strip is now runes that ignite.
  The pulse line is drawn by a glowing pen tip. The autopsy is a case file with staggered findings, engraved glyphs
  and an animated expand. The countdown has a burning candle that turns red and gutters under 2:00.
- Other screens: a fog wipe between the landing and `/r/:id`. Graveyard stones sway and glow on hover, lit by status;
  expired stones have moss and a crack. TurnedAway has a locked gate, CannotRise has a slab with sleeping spirits,
  the 404 has a swinging lantern, and the RIP page and footer were restyled.
- Integration fixes I made: the Risen and ErrorGhost card entrances and the séance ink effect now use CSS keyframes
  (`fill-mode: both`) instead of framer-motion. That way a card or log line can never be left invisible or blurred.
  The tombstone rise has a 2.5 s safety snap to standing. The 404 lantern chain now reaches the lantern.

**Screenshots:** `frontend/screenshots/` (1440x900 and 390x844). They were made with headless Chrome against the mock;
`seed.html` backdates a mock run to jump to each state.
- Capture caveat: with full motion, headless virtual time stalls once the scene's continuous animations start.
  The DOM showed the stone stuck on its first frame, and timers never fired. Because of that,
  `risen-phone`, `ghost-phone` and `cannot-rise-*` were captured with `--force-prefers-reduced-motion`. These show
  the end states correctly. **Check the full-motion versions of those three in a real browser.**

**Check by eye (in a real browser, mock on)**
- The Risen sequence on a phone: the card should rise after about 1.8 s, and the light column should be spectral,
  not dark (in headless it looked dark because it was captured mid-animation).
- The cannot_rise grey stone rises and stays up.
- The ghost looks a little soft and round, close to cartoon. If it reads as cheesy, sharpen its silhouette.
- The countdown candle assumes a 20-minute lifetime, so with `VITE_MOCK_LIFETIME_S=60` it starts nearly burnt down.
- The intro plays only once per session. Use a new tab or clear sessionStorage `resurrect:intro-seen` to see it again.

**Unfinished:** Lighthouse was not run. Expired has no illustration of its own (its tombstone has moss only). A 390 px
horizontal overflow check was done only visually from the screenshots (`html` also has `overflow-x: hidden`).


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
