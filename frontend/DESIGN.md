# Resurrect frontend design

## User flow and screens

The app has two routes, `/` and `/r/:id`. Every screen on `/r/:id` is chosen by the record's `status` alone, so a reload or a shared link always shows the right screen.

Flow:

- Paste repo URL → Autopsy (rules + Bedrock, ~5 s)
- Autopsy blocked → Cannot rise yet (findings and fixes)
- Autopsy passes → Séance (CodeBuild, live logs)
- Build fails → Error ghost (cause, fix, command) → Try again → Séance
- Build succeeds → Pulse check (up to 60 s)
- No pulse → Error ghost
- Alive → Risen (link, badge, 20:00 countdown)
- After 20 min → Expired (RIP page at the link) → Resurrect again (new id) → Paste repo URL

The autopsy runs on every request; only repos that pass it are built. A failed build or a failed pulse check both end in an error ghost, and Try again re-runs the autopsy and the build.

| Screen | Shown when | What the user sees |
| --- | --- | --- |
| Landing | route `/` | Moonlit graveyard scene, RESURRECT wordmark, URL input with "Begin the ritual", and Your graveyard below. |
| Tombstone rise | first load of `/r/:id` | A tombstone engraved with the repo name rises from the ground and the fog parts. |
| Autopsy report | every record | Parchment card: detected stack, one-line summary, findings with ok / warn / block icons and their fixes. Stays above the séance. |
| Séance | `summoning`, `building` | Candle-lit panel, logs typed out in a typewriter face, phase strip: Summoning → Cloning → Installing → Building → Uploading. |
| Pulse check | `checking_pulse` | "Checking for a pulse… attempt N of M" with a heartbeat line. |
| Risen | `alive` | Tombstone cracks open, "It lives.", Visit button, copy URL, README badge with its markdown, 20:00 countdown ("Eternal" when pinned). |
| Error ghost | `failed` | Original ghost figure. Cause, Fix, Command with copy, confidence chip, "Last words from the séance" (raw log tail), Try again. |
| Cannot rise yet | `cannot_rise` | The autopsy report, "This spirit can't rise yet. We can only raise static sites and React apps today", and the fixes. |
| Turned away | API error 4xx / 429 / 503 | Themed message per error code (copy table below). |
| Expired | `expired` | Tombstone closes. "Rest in peace. Resurrect again?" starts a new resurrection of the same repo. |
| RIP page | dead link on the graves domain | Standalone page: miniature scene, closed tombstone, Resurrect again link back to the app. |
| 404 | unknown route in the app | "You wandered off the path." with a lantern and a link home. |

## Visual design system

The look is a painterly moonlit graveyard: deep blue-black, cold mist, and warm ember light from lanterns and pumpkins. The séance switches to candlelight and typewriter text. Every visual is original and drawn in code (SVG, canvas, CSS), so it animates, scales to phones and carries no licensing risk.

Taken from Halloween designs on Dribbble: a two-tone palette (night blue against pumpkin orange), big serif display type, and frosted "glass" panels floating over an illustrated scene. Skipped: 3D character renders.

### Colour tokens

| Token | Hex | Used for |
| --- | --- | --- |
| night-950 | #07080F | Page background, deepest sky |
| night-900 | #0D1020 | Panels, séance background |
| night-800 | #161A33 | Sky near the horizon, raised cards |
| mist | #8FA3C7 | Fog, secondary text, borders at low opacity |
| moon | #E9ECF5 | Moon, primary text on dark |
| ember-500 | #FF8A1F | Primary buttons, glows, focus rings, warnings |
| ember-300 | #FFB35C | Hover states, flame tips, countdown digits |
| spectral | #7DE2D1 | Alive, success, the rising light burst |
| blood | #E5484D | Blocking findings, last 2 minutes of the countdown |
| bone | #E8E1D0 | Text on parchment |
| parchment | #D9C9A3 | Autopsy report card |

### Type (Google Fonts, free OFL licences)

- Cinzel 600/700: wordmark, headings, countdown digits. Reads like carved stone.
- Inter 400/500/600: all interface text, buttons, findings.
- Special Elite: séance log lines and autopsy headings. Typewriter.

### Art drawn in code

- Sky: gradient from night-950 to night-800, canvas starfield (≤ 150 twinkling stars).
- Moon: limb-darkened disc with soft maria, a layered corona and thin moonlit cloud wisps; soft moonlight shafts slant through the trees, and a WebGL ground fog (CSS fallback) is lit cold by the moon and warm by the flames.
- Layers, back to front: hills, dead trees, wrought-iron fence, tombstones, ground fog. Each layer moves with the pointer by its depth (nearest about 20 px).
- Fog: 3–4 blurred layers drifting at different speeds, capped at 30 fps.
- Bats: 5–7 small SVG bats on curved paths at random intervals.
- Jack-o'-lanterns: 2–3 ribbed SVG pumpkins lit from inside by a layered flame that throws flickering light on the soil and nearby stones.
- The Keeper: an original hooded lantern-bearer at the right edge, faceless with two faint ember eyes, lighting the URL input. No floating skeletal hands or tattered shroud, so it can't be mistaken for a film creature. Hidden on phones.
- Ghost (error state): a translucent, cold-tinted spirit fraying into a torn hem, with pale eye hollows, drifting gently.
- Candlelight cursor: a faint warm glow follows the pointer on the landing page.

### Motion

| Moment | Animation |
| --- | --- |
| Ritual starts | Camera eases down; a tombstone with the repo name rises from the ground |
| Autopsy | Findings appear one by one, 80 ms apart |
| Séance | Lines type out at about 4 ms per character; candles flicker; animation skipped when 20+ lines are queued |
| Pulse check | Heartbeat line sweeps across; attempt counter ticks |
| Risen | Tombstone splits and falls aside; spectral light burst; card fades up |
| Failed | Ghost drifts up out of the tombstone |
| Countdown under 2:00 | Digits turn blood red and pulse |
| Expired | Tombstone slides shut |

With `prefers-reduced-motion`, bats, fog drift, parallax and typing stop; state changes become simple fades.

### Copy voice

Spooky in the headline, plain in the detail. A student must always understand what went wrong.

| Situation | Copy |
| --- | --- |
| Tagline | Bring your dead repos back to life. |
| Sub-line | Paste a public GitHub repo. We'll perform the autopsy, hold the séance and raise it from the grave, live for 20 minutes. |
| Button | Begin the ritual |
| Invalid URL | That isn't a grave we can find. Paste a github.com/owner/repo link. |
| Alive | It lives. |
| Fallback ghost | The spirits are silent. Here is the raw log. |
| cannot_rise | This spirit can't rise yet. We can only raise static sites and React apps today, but here's what's wrong with it. |
| rate_limited | The graveyard is full for you this hour. Return in {mm} minutes. |
| quota_exhausted | Tonight's rituals are spent. Come back tomorrow. |
| resurrections_disabled | The spirits are resting. Resurrections are paused. |
| repo_not_found | No grave by that name. Is the repo public? |
| repo_too_large | This one is too heavy to lift (over 100 MB). |
| Expired | Rest in peace. Resurrect again? |
| Empty graveyard | Your graveyard is empty. For now. |
| 404 | You wandered off the path. |

### Quality bar

- Works from 360 px to 1920 px wide; no horizontal scroll.
- Text contrast at least 4.5:1; ember focus rings on every control; keyboard reachable.
- No image asset over 100 KB; Lighthouse performance at least 85 on desktop.
- Footer on every screen names the AWS services: Lambda · CodeBuild · S3 · CloudFront · DynamoDB · Bedrock · EventBridge.
