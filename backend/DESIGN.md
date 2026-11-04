# Resurrect — backend design (from the MVP Build Plan, sections 4 and 6)

## 4. Architecture and AWS resources

One Lambda coordinates everything and never runs student code. CodeBuild clones and builds in a throwaway container, S3 stores the output, and two CloudFront distributions serve it. Nothing needs a VPC, a NAT or a load balancer.

On each poll, the API also reads build logs from CloudWatch. After deleting a site, the reaper invalidates the graves cache. No EventBridge rule watches CodeBuild: the API asks CodeBuild for the build state whenever the frontend polls.

Region: us-east-1 for everything. API: FastAPI on Lambda (Mangum) behind a Function URL. No SSE: the frontend polls every 2 s, and each poll advances the state machine.

| Resource | Name | Key settings | Monthly cost at demo scale |
|---|---|---|---|
| S3 bucket | `resurrect-<account-id>` | Private, block public access, SSE-S3. Prefixes `ui/`, `graves/`, `graves/_rip/`. Lifecycle: delete `graves/` objects after 2 days (safety net only). | Cents |
| CloudFront "ui" | `resurrect-ui` | Origin path `/ui`, OAC, default root `index.html`, 403/404 → `/index.html` with 200, CachingOptimized, price class 100, no WAF. | Free tier |
| CloudFront "graves" | `resurrect-graves` | Origin path `/graves`, OAC, viewer-request CloudFront Function adds `index.html` to folder paths, cache TTL 0–60 s, 403/404 → `/_rip/index.html` with 404, error caching TTL 0, no WAF. | Free tier |
| DynamoDB | `resurrect-records` | On-demand, partition key `pk` (string), TTL attribute `ttl`. Holds records and rate-limit counters. | Free tier |
| Lambda API | `resurrect-api` | Python 3.12, x86_64, 512 MB, 30 s timeout, Function URL with auth NONE and CORS for the UI domain and `http://localhost:5173`. | Free tier |
| Lambda reaper | `resurrect-reaper` | Same package, handler `app.reaper.handler`, 256 MB, 60 s. | Free tier |
| CodeBuild | `resurrect-build` | No source, inline buildspec from `buildspec/static-react.yml`, `aws/codebuild/standard:7.0`, small Linux, 10-minute build and queue timeouts. | 100 free build minutes, then $0.005/min |
| CloudWatch Logs | `/resurrect/builds` + Lambda groups | Retention 3 days. | Cents |
| EventBridge Scheduler | group `resurrect` | One-off `at()` schedules created at runtime, deleted after they fire. Role allowed to invoke only the reaper. | Free tier |
| Bedrock | model ID in `BEDROCK_MODEL_ID` | Converse API; small fast model (Claude Haiku or Amazon Nova Lite). Raw-error fallback. | A few cents a day |
| SSM Parameter Store | `/resurrect/github-token`, `/resurrect/admin-token` | SecureString, created by CLI, never in Terraform or git. | Free |
| Budgets | console | Alerts at $5 and $10. | Free |

### IAM, scoped per component
- **API Lambda:** DynamoDB get/put/update/query on the table; `codebuild:StartBuild` and `BatchGetBuilds` on the project; `logs:GetLogEvents` on the build log group; Bedrock `InvokeModel` (covers the Converse API); `ssm:GetParameter` on the two parameters; `scheduler:CreateSchedule` / `DeleteSchedule` in the group plus `iam:PassRole` on the scheduler role; `cloudfront:CreateInvalidation` on the graves distribution.
- **CodeBuild role:** `s3:PutObject` and `s3:DeleteObject` under `graves/r-*`, `s3:ListBucket` with that prefix; write to its log group. No secrets in its environment.
- **Reaper Lambda:** list and delete under `graves/r-*`; DynamoDB `UpdateItem`; `cloudfront:CreateInvalidation` on graves.
- **Scheduler role:** `lambda:InvokeFunction` on the reaper only.

### URL shapes
- Resurrect app: `https://<ui-domain>/` and `https://<ui-domain>/r/<id>`
- Live student site: `https://<graves-domain>/<id>/` (S3 key `graves/<id>/...`)
- Badge: `<api-url>/badge/<id>.svg`, linking to `https://<ui-domain>/r/<id>`
- Dead link: any missing path on the graves domain shows `graves/_rip/index.html` with status 404

## 6. Autopsy, ghosts, pulse, expiry and guardrails

The autopsy blocks only when a build is certain to fail or the stack can't be hosted. The LLM can add warnings but can never block. Everything here lives in `backend/`.

Deployable stacks: static HTML, React with Vite, React with Create React App, at the root folder or one level down (`frontend/`, `client/`, `web/`, `app/`, `site/`). Python, Express, Next and similar get the autopsy plus fixes and the message "can't rise yet". No build.

### Autopsy steps (inside POST, target under 6 s)
1. Parse the URL: `https://github.com/<owner>/<repo>`, optional `.git` or `/tree/<branch>`. Anything else is `invalid_url`.
2. `GET /repos/{owner}/{repo}` with the token. 404 or private gives `repo_not_found`. `size` over 102,400 KB gives `repo_too_large`.
3. `GET /repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1` for the file list and commit SHA.
4. Pick `app_dir`: the root if it has `package.json` or `index.html`, else the first of `frontend/`, `client/`, `web/`, `app/`, `site/` that does.
5. Fetch up to four files from `raw.githubusercontent.com`: `package.json`, `requirements.txt` or `pyproject.toml`, `index.html`, `vite.config.(js|ts|mjs)`.
6. Run the rules below, then ask Bedrock for the summary and up to 3 extra warnings (6 s timeout; on failure keep the rules summary and set `source` to `rules`).

### Rules

| Rule id | Condition | Severity | Fix shown |
|---|---|---|---|
| `empty-repo` | No files in the tree | block | Push your code to the default branch. |
| `stack-static` | `index.html`, no `package.json` | ok | — |
| `stack-vite` | `package.json` has `vite` in dependencies and a build script | ok | — |
| `stack-cra` | `package.json` has `react-scripts` | ok | — |
| `no-build-script` | `package.json` without a build script and no root `index.html` | block | Add `"build": "vite build"` to scripts. |
| `vite-no-index` | Vite app without `index.html` in `app_dir` | block | Vite needs `index.html` next to `package.json`. |
| `stack-node-server` | `express`, `fastify`, `koa`, `@nestjs/core` or `next` and no static build | block (cannot rise) | Server apps arrive in a later version. |
| `stack-python` | `requirements.txt`, `pyproject.toml`, `manage.py`, or FastAPI / Flask / Django | block (cannot rise) | Python resurrection is coming next. |
| `stack-unknown` | None of the above | block | Static HTML and React apps can rise today. |
| `no-lockfile` | No `package-lock.json` or `npm-shrinkwrap.json` | warn | Run `npm install` and commit `package-lock.json`. |
| `env-committed` | `.env` or `.env.local` in the tree | warn | Delete it, add it to `.gitignore` and rotate any keys inside. |
| `vite-base-set` | `vite.config` sets `base` | warn | We override it during the build; check your asset paths. |
| `node-engine` | `engines.node` requires a version above 20 | warn | We build on Node 20. |

Verdict: any block gives `blocked` and status `cannot_rise`; any warn gives `warnings`; otherwise `healthy`. Blocked repos never start a build and never count against the daily build quota.

### Build (`buildspec/static-react.yml`)
- Environment passed to StartBuild: `REPO_URL`, `RES_ID`, `STACK`, `APP_DIR`, `BUCKET`, `COMMIT_SHA`.
- Clone with `git clone --depth 1` on the default branch.
- **static:** upload `APP_DIR` to `s3://$BUCKET/graves/$RES_ID/`, excluding `.git/`.
- **react-vite:** `npm ci` (fall back to `npm install`), then `npx vite build --base=/$RES_ID/ --outDir __resurrect_dist`, upload the output.
- **react-cra:** `PUBLIC_URL=/$RES_ID/ CI=false npm run build`, upload `build/`.
- Print marker lines such as `::resurrect:: phase=installing` before each step. The API hides these lines and turns them into `phase_message`.

### Error ghost
Input: the detected stack, autopsy findings, `package.json` (if any), and the last 80 log lines. For a pulse failure, use the HTTP results instead of logs.

Everything is scrubbed first: AWS keys (`AKIA…`), GitHub tokens (`ghp_`, `github_pat_`), `sk-…` keys, Slack tokens, private-key blocks, and key=value pairs whose key contains secret, token, password or apikey. Total input is capped at about 12 KB.

System prompt (stored in `backend/app/ghost.py`):

```
You diagnose failed deployments of student web projects for Resurrect.
You receive the detected stack, autopsy findings, package.json and the last lines of the build log,
or HTTP check results if the build passed but the site did not respond.
Find the FIRST real error, not its consequences.
Reply with ONLY a JSON object:
{"cause": "...", "fix": "...", "command": "..." or null, "confidence": "high" | "medium" | "low"}
- cause: at most 25 words, plain English a first-year student understands; name the file or package.
- fix: at most 30 words, one concrete action.
- command: one shell command run from the repo root that applies the fix, or null if none is safe.
- Never suggest commands that delete files, rewrite git history or use sudo.
- If the log is cut off or unclear, say so and set confidence to low.
```

Fallback, when Bedrock fails or the JSON is invalid:
- cause: "The build failed before the spirits could explain why."
- fix: "Read the last lines of the séance below; the first error is usually the real one."
- command: null
- confidence: low
- source: fallback

### Pulse check (driven by polls)
When CodeBuild reports `SUCCEEDED`, the status becomes `checking_pulse`. On each GET, if at least 2 s have passed since the last probe, the API makes one probe with a 3 s timeout:
1. `GET https://<graves-domain>/<id>/` must return 200 with `<html` in the body.
2. The first `src` or `href` starting with `/<id>/` must also return 200. This catches the blank-page base-path bug.

If both pass: `alive`. If it's still failing after 60 s or 20 attempts: `failed`, with a ghost built from the probe results.

### Expiry
- On `alive` (not pinned): `alive_at` = now, `expires_at` = now + 20 minutes. The API creates schedule `reap-<id>` in group `resurrect` with `at(<expires_at>)`, targeting the reaper with input `{"id": "<id>"}`, flexible window off, deleted after completion.
- The reaper deletes every object under `graves/<id>/`, invalidates `/<id>/*` on the graves distribution, and sets status `expired` unless the record is pinned.
- Any GET past `expires_at` reports `expired`, even if the reaper is late.
- "Resurrect again" is a new POST with the same repo URL, so it gets a new id and a fresh 20 minutes.
- Pinned records have no schedule and `expires_at` null. `scripts/pin.py <id>` pins; `--unpin` restores a 20-minute expiry from now.

### Guardrails

| Guardrail | How | Response |
|---|---|---|
| Kill switch | Lambda env var `RESURRECTIONS_ENABLED` (Terraform variable). Checked on POST and retry. | 503 `resurrections_disabled` |
| 3 requests per IP per hour | Counter item `ip#<sha256(ip)[:16]>#<YYYYMMDDHH>`, atomic add with a condition, TTL 2 h. Counts POST and retry. | 429 `rate_limited`, `retry_after_s` to the next hour |
| 50 builds per day | Counter item `quota#<YYYY-MM-DD>`, incremented only when a build starts. | 429 `quota_exhausted` |
| 10-minute build timeout | CodeBuild `timeout_in_minutes = 10` | Build `TIMED_OUT` becomes a ghost |
| 100 MB repo cap | GitHub `size` field | 422 `repo_too_large` |
| Admin bypass | `X-Resurrect-Admin` equal to SSM `/resurrect/admin-token` skips the IP limit and quota | — |
| Budgets | Console alerts at $5 and $10 | Email |
