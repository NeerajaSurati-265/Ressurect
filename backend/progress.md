# Backend progress (Person B)

## Step 1 — Preflight and design doc: DONE

**Files**
- `backend/DESIGN.md` — architecture and rules, saved verbatim from the B1 prompt (read by B2/B3).
- `backend/progress.md` — this log.

**Checks**
- `aws sts get-caller-identity`: account 847460071971, user `terraform-admin`. CLI default region is ap-south-1, so every command is pinned to `--region us-east-1`.
- Tools: terraform 1.16.1, aws-cli 2.36.31, pip 25.3 (Python 3.10), zip, jq 1.6, node 22, PyYAML 5.4.1. `python3.12` is not installed.
- SSM `/resurrect/github-token` and `/resurrect/admin-token` exist in us-east-1 (names only checked). They were first missing in both regions; the user then created them.
- Services respond in us-east-1: codebuild, scheduler (group `default` only), cloudfront, lambda, bedrock.
- `aws bedrock-runtime converse` with `us.amazon.nova-lite-v1:0` in us-east-1 returned a reply.

**Decisions / deviations**
- `BEDROCK_MODEL_ID` = `us.amazon.nova-lite-v1:0`.
- No python3.12 locally: the Lambda zip will cross-download wheels with pip's `--platform` flags (pip upgraded first).
- Manual CodeBuild test will use the user's `todo-of-the-dead` repo (URL pending, needed before Step 5).

**Open issues**
- `todo-of-the-dead` repo URL still needed before Step 5.

**Next:** Step 2 (Terraform).

## Steps 2-4 — Terraform, buildspec, packaging: DONE (not yet applied)

**Files added**
- `infra/main.tf` — provider (us-east-1, aws ~> 6.0), locals, account and `alias/aws/ssm` lookups.
- `infra/variables.tf` — `bedrock_model_id` (default `us.amazon.nova-lite-v1:0`), `resurrections_enabled` (bool, default true).
- `infra/outputs.tf` — bucket, both URLs and distribution ids, api_url.
- `infra/s3.tf` — private SSE-S3 bucket, public access block, 2-day lifecycle on `graves/`, OAC bucket policy for both distributions.
- `infra/cloudfront.tf` — `ui` (SPA fallback) and `graves` (index-rewrite function, 0/60/60 cache policy, 404 tombstone) distributions.
- `infra/cf_index_rewrite.js`, `infra/test_cf_function.js` — viewer-request function and its node test.
- `infra/dynamodb.tf`, `infra/logs.tf`, `infra/codebuild.tf`, `infra/scheduler.tf`, `infra/lambda.tf` — remaining resources and scoped IAM.
- `infra/README.md` — apply steps, secret rotation, kill switch.
- `buildspec/static-react.yml` — clone, per-stack install/build/upload with `::resurrect::` phase markers.
- `scripts/package_backend.sh`, `backend/requirements.txt`, `backend/app/{__init__,main,reaper}.py` — packaging and placeholders.

**Checks**
- `terraform fmt -check -recursive`, `init`, `validate`: pass. `node infra/test_cf_function.js`: 5/5 pass.
- Buildspec: YAML parses; `bash -n` passes on its single command block.
- Package: `build/api.zip` (3.5 MB) contains `app/main.py`, `app/reaper.py`, `fastapi/`, `mangum/`, `pydantic_core/_pydantic_core.cpython-312-x86_64-linux-gnu.so`.
- `.gitignore` already covers `build`, `infra/.terraform`, `*.tfstate`.

**Decisions / deviations**
- Steps 3-4 files were written before the Step 2 check because `validate` needs `buildspec/static-react.yml` and `build/api.zip` to exist.
- Buildspec uses one command block with a `case` on STACK, so `cd` and the build share a shell.
- Reaper Lambda also gets `TABLE_NAME`, `BUCKET`, `GRAVES_DISTRIBUTION_ID` env vars (not in the prompt list; needed for its work).
- Function URL has both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` (`invoked_via_function_url`) permissions.
- Bedrock IAM covers `foundation-model/*` in all regions plus account inference profiles (needed for the `us.` cross-region profile).
- Placeholder pip cross-download used instead of python3.12 (not installed locally).

**Next:** Step 5 (plan, wait for OK, apply, verify). Need the `todo-of-the-dead` URL.

## Step 5 — Apply and verify: DONE

Applied: 29 added, 0 changed, 0 destroyed. Outputs saved to `infra/outputs.json` (scan for token/secret/key patterns: 0 hits).

**Results**
- `GET <api_url>/health` -> 200 `{"ok":true,"resurrections_enabled":true}` (not 403; both Lambda URL permissions work).
- CORS preflight (Origin localhost:5173, POST) -> 200 with `Access-Control-Allow-Origin: http://localhost:5173`, methods `POST,GET`, headers `x-resurrect-admin,content-type`, max-age 3600.
- Reaper invoked once -> 200; log group `/aws/lambda/resurrect-reaper` has the "reaper placeholder received event" line.
- CodeBuild manual run: `STACK=react-vite RES_ID=r-test01 APP_DIR=packages/create-vite/template-react`, repo `https://github.com/vitejs/vite` (official Vite React template; `todo-of-the-dead` not pushed yet). Status SUCCEEDED. Marker lines in `/resurrect/builds`: `::resurrect:: phase=cloning`, `installing`, `building`, `uploading`, `done`.
- Test `ui/index.html`: `<ui_url>/` 200, `<ui_url>/r/abc` 200 (SPA fallback).
- `<graves_url>/r-test/` 200, `<graves_url>/r-test` 200, `<graves_url>/r-nothere/` 404 with the `_rip` page body.
- `<graves_url>/r-test01/` 200 with `<html`; its JS and CSS assets under `/r-test01/assets/` return 200.
- Cleanup: removed `graves/r-test/`, `graves/r-test01/`, `ui/index.html`. Kept `graves/_rip/index.html` (simple placeholder; Person A's deploy script replaces it).

**Notes for B2**
- CodeBuild also echoes each buildspec command into the log, so lines like `echo "::resurrect:: phase=building"` appear. The log parser must treat only lines that START with `::resurrect::` as markers, and hide the echoed command lines (they begin with `echo` or are whitespace-indented copies of it).
- Python 3.10 cross-download of wheels worked for the Lambda zip.

**Open issues**
- `todo-of-the-dead` has not been tested; re-run the CodeBuild check once it is pushed.
- `ui/` is empty until Person A deploys the frontend; `_rip` is a placeholder.

**Next: B2.**

## B2 Steps 1-3 — API core: DONE locally (not yet deployed)

**Files added** (all in `backend/`)
- `app/errors.py` — `ApiException` with the contract's error codes and HTTP statuses.
- `app/config.py` — env settings from B1, cached boto3 clients (region pinned to us-east-1), GitHub token read once per cold start from SSM (decrypted).
- `app/models.py` — Pydantic models identical to `contracts/types.ts`, plus `StoredRecord` (public record + internal fields `build_id`, `log_stream`, `pulse_started_at`, `last_probe_at`, `pulse_lines`, `client_ip`, `package_json`, `version`).
- `app/store.py` — DynamoDB: pk `res#<id>`, whole record as one JSON `doc`, `version` conditional writes, `ttl` = created + 7 days.
- `app/github.py`, `app/autopsy.py` — URL parsing, repo/tree/commit/raw fetches, every rule in DESIGN.md, verdict.
- `app/builds.py`, `app/logs.py`, `app/pulse.py`, `app/statemachine.py`, `app/service.py`, `app/timeutil.py` — build start/status, CloudWatch logs and markers, probe, transitions, POST/retry flows.
- `app/main.py` — routes, ApiError envelope, catch-all 500 `internal`, Mangum `lifespan="off"`.
- Stubs for B3: `app/limits.py`, `app/ghost.py` (fallback ghost + rules-only summary), `app/expiry.py`, `app/badge.py`. `app/reaper.py` untouched.
- `requirements-dev.txt` (pytest, respx, boto3), `tests/` (conftest, helpers, 6 test files).

**Checks** (`cd backend && env -u PYTHONPATH .venv/bin/python -m pytest -q tests`): 120 passed.
- Models vs `types.ts` (parsed from the TS file: names, nullability, literal unions), contract example round-trips exactly, nulls kept.
- URL parsing good/bad, every autopsy rule on fixture trees, GitHub client errors (404, private, too large, empty repo, timeout).
- State machine: every transition, 2 s probe gap, 60 s and 20-attempt deadlines, expiry, pinned. API: POST/GET/logs/retry/404/409/400/500, version-conflict reload, phase_message write losing the race (skipped, lines still returned).

**Decisions / deviations**
- Python: no uv/3.12 locally, so the code is 3.10-compatible and tests run in `backend/.venv` (git-ignored). Run pytest with `env -u PYTHONPATH` because a ROS install on this machine injects broken pytest plugins.
- Autopsy and build always use the repo's default branch (the buildspec clones the default branch); a `/tree/<branch>` in the URL is accepted but not used.
- Commit SHA comes from `GET /commits/<branch>` (sha media type), shortened to 7 chars; the trees endpoint only returns a tree sha.
- Vite counts as a dependency in either `dependencies` or `devDependencies`; a Vite app with no `build` script still builds (the buildspec runs `npx vite build`).
- Python markers win over node-server/no-build rules, but a root `index.html` with no `package.json` stays static.
- The kill switch (503 `resurrections_disabled`) is checked in `service.py` on POST and retry; it was not listed for B2 but is one line.
- `limits.check` is a no-op until B3, so POST is currently unthrottled; keep live tests few.
- Cursor is an opaque base64 JSON `{t: cloudwatch token, p: pulse lines seen}`.
- `expiry.schedule` runs before the save; if the save loses a version race the stub is harmless, but B3's schedule creation must be idempotent.

**Next:** B2 Step 4 (package, plan, apply after OK, live verification).

## B2 Step 4 — Deploy and live verification: DONE

Deployed twice (Lambda code only: 0 added, 2 changed, 0 destroyed; the scheduler policy shows as "changing" in plans with identical content).

**Live results** (API `https://o5praykw6fdpudfk6pyzqpnid40pnjwt.lambda-url.us-east-1.on.aws`)
- POST `https://github.com/NeerajaSurati-265/todo-of-the-dead` -> 201 `summoning` (`r-qm4pxy`, react-vite, healthy, commit 6fe0807).
- Polling every 2 s reached `alive` in ~30 s; phase_message went Cloning the grave -> Building -> Uploading the remains -> Checking for a pulse -> It lives. Pulse passed on attempt 1.
- `<graves_url>/r-qm4pxy/` 200; its JS asset `/r-qm4pxy/assets/index-DmiIK5l4.js` 200.
- Logs: 114 build lines + 1 pulse line, 0 visible `::resurrect::` lines; cursor re-poll returns 0 lines with the same token, `done: true` once terminal.
- Python repo (`tiangolo/full-stack-fastapi-template`, now `fastapi/full-stack-fastapi-template`) -> `cannot_rise`, stack python, findings stack-python:block, no-lockfile:warn, env-committed:warn, no build started.
- `broken-potion` (`r-ucoiop`) -> build failed -> `failed` with the fallback ghost (B3 fills in the LLM one). `raw_tail` has 80 lines and contains the real error (rolldown stack). Retry -> 200, `attempt: 2`, ghost/pulse cleared, new build, failed again with attempt 2.
- Bad URL -> 400 `invalid_url`; unknown id -> 404 `not_found`; retry on alive -> 409 `not_retryable`.
- CORS from `http://localhost:5173`: allow-origin header present on POST and OPTIONS.
- `/aws/lambda/resurrect-api`: no Traceback/ERROR/Exception lines.

**Bug found and fixed during live testing**
- Renamed GitHub repos (301 on the API) returned 500 `internal`. The client now follows redirects and uses GitHub's canonical owner/name for later calls and for `repo.url`. Test added; 121 tests pass.

**Open issues / notes for B3**
- `limits.check`, `expiry.schedule`, real ghost (Bedrock), `autopsy_summary` (Bedrock) and the reaper are still stubs. Until the reaper and schedule exist, live test sites stay in S3 until the 2-day lifecycle rule removes them (`graves/r-qm4pxy/` and any others from these tests). Nothing was deleted.
- Test records left in DynamoDB expire by TTL after 7 days.
- `expiry.schedule` runs before the record save in `statemachine._mark_alive`; B3's schedule creation must be idempotent (a lost version race means it can run twice for the same id).
- Autopsy always analyses the default branch; a `/tree/<branch>` URL is accepted but ignored.
- Ghost `raw_tail` is the unfiltered last 80 build lines; B3's scrubber must redact secrets before sending to Bedrock.

**Next: B3.**

## B3 Steps 1-5 — ghosts, guardrails, expiry, badge: DONE locally (not yet deployed)

**Files added**
- `app/bedrock.py` — `converse_json` (Converse API, temp 0.2, 1 attempt, connect 2 s, read `timeout_s`), `extract_json`.
- `app/scrub.py` — secret redaction + `cap_text` (12 KB, keeps the end).
- `scripts/pin.py` — pin/unpin via the backend's `store` and `expiry` modules; settings from `infra/outputs.json`.
- `tests/test_{scrub,bedrock,ghost,limits,expiry_reaper,badge}.py`.

**Files changed**
- `app/ghost.py` — real `explain` and `autopsy_summary` (DESIGN.md prompt verbatim; command blocklist; extras forced to `warn`, ids `llm-*`).
- `app/limits.py` — `check` (IP limit), `reserve_build` (daily quota), `is_admin` (SSM, cached, `compare_digest`).
- `app/expiry.py` (`schedule`, `cancel`), `app/reaper.py`, `app/badge.py`.
- `app/service.py` (quota reserved right before `builds.start`), `app/statemachine.py` and `app/autopsy.py` (new ghost/summary signatures), `app/main.py` (badge route, no-cache headers).
- `tests/conftest.py` — autouse guards: no real Bedrock or boto3 in tests. `tests/test_api.py` — badge header assertion.
- `infra/lambda.tf` (reaper DynamoDB Get/Put/Update; `LIFETIME_MINUTES` from a variable), `infra/variables.tf` (`lifetime_minutes`), `infra/outputs.tf` (`table_name`, `reaper_arn`, `scheduler_role_arn`, `schedule_group`).

**Checks**: `env -u PYTHONPATH .venv/bin/python -m pytest -q tests` -> 194 passed. `terraform validate` OK. Package built (3.6 MB). `terraform plan`: 0 add, 4 change, 0 destroy (reaper policy, scheduler policy re-render, both Lambdas).

**Decisions / deviations**
- Records are a JSON `doc` in DynamoDB, so the reaper and pin script read the record and write it back with `store.save` (version-conditional, retried) instead of a raw UpdateItem. The reaper IAM gained `GetItem` and `PutItem`.
- Bedrock IAM already allows `foundation-model/*` in all regions plus the us-east-1 inference-profile ARN, so the cross-region `us.` profile needs no change.
- Reaper accepts only ids matching `^r-[a-z0-9]{6}$`, so an event can never delete outside `graves/r-*`.
- An earlier local test run wrote rate-limit counters (`ip#<hash of "unknown">#<hour>`, TTL 2 h) to the real table, because tests could reach AWS. Fixed with the conftest guard.
- `limits.check` keeps its B2 name for the IP limit; `reserve_build` is new.

**Next:** Step 6 (apply after OK, live checks).

## B3 Step 6 — live checks (in progress)

Applied B3 (3 changed). `infra/outputs.json` regenerated (10 outputs, 0 secret-pattern hits).

**Counter cleanup**: scanned `resurrect-records` for `ip#`/`quota#` before testing. Found `quota#2026-11-04` count 3 and `ip#b23a6a8439c0dde5#2026110408` count 3 (hash of the literal "unknown" IP). Real counted builds before this deploy: 0 (limits were a no-op). Both were written by tests; both deleted. Suite re-run with AWS credentials unset and config files pointed at nothing: 194 passed, and `boto3.Session().get_credentials()` is None there.

**First live round (deploy #1)**
- Autopsy summary on todo-of-the-dead: PASS (`source: rules+llm`, natural summary), but the model added two speculative warnings ("missing favicon", "add react-router-dom") that were false. Prompt tightened (only report what the provided files prove; empty list is normal).
- Ghost on broken-potion: FAIL. `source: llm` but cause was "Vite build process encountered an error", command `npm ci`. Root cause: the last 80 log lines were CodeBuild boilerplate and the echoed buildspec; the real error (line 77 of 160) was outside the window. Fix: `_visible` drops `[Container]` lines and the echoed script; a "lines that look like errors" block is added to the prompt. Offline replay of the saved log against real Bedrock: 3/3 name `react-router-dom` with `npm install react-router-dom`. Test added (195 pass).
- Badge: PASS (200, `image/svg+xml`, `cache-control: no-cache, max-age=0`, "alive"; unknown id -> 404 SVG "unknown").
- Schedule `reap-r-ccs3zj`: PASS (`at(2026-11-04T08:37:43)`, UTC, flex OFF, DELETE, input `{"id": "r-ccs3zj"}`, matches `expires_at`).
- Pin: PASS. Pin -> `expires_at` null, schedule gone, badge "eternal"; unpin -> +20 min, schedule recreated, badge "alive"; pinning a failed record refused.
- POST latency: 7.1 s cold, 3.0 s warm (limit 15 s).

**Second/third round (deploys #2 and #3, code-only, same plan shape 0/3/0)**
- Ghost still wrong live after fix #1: `logs.tail(rec, 80)` cut the raw log to 80 lines *before* the ghost filtered it. `logs.tail` now returns up to 400 lines (CloudWatch limit 800) and the ghost does its own filter + last-80 window. Test added.
- `_visible` now drops all three echoes of the buildspec script CodeBuild prints (after "Running command set -euo pipefail", "Command did not exit successfully", "Error while executing command"). `tail_window` makes `raw_tail` the last 10 filtered lines, slid back to start at the first error line when it falls within the last 40 lines (otherwise the 10 lines are just stack frames). Fixture `tests/fixtures/broken_potion.log` is the real log (0 secret-pattern hits).
- Ghost on broken-potion (`r-80q9rm`): PASS. `source: llm`, cause "The project is missing the 'react-router-dom' package.", command `npm install react-router-dom`, confidence high, `raw_tail` 10 lines starting at "error during build:" with the Rolldown error, 0 marker lines.
- Rate limit: PASS. 3x 201 `cannot_rise` (python), 4th 429 `rate_limited` `retry_after_s` 1944; admin POST afterwards 201. **The tester's IP is now rate-limited until the top of the hour. Frontend testing from this IP must use the admin header (`localStorage["resurrect.admin"]`).** Admin POSTs do not count against the IP limit.
- Autopsy extras: the model kept adding "X is missing / not provided in the key files" warnings it cannot verify (it sees at most 4 files). `autopsy_summary` now drops any extra that claims absence (regex), and the prompt says so. Test added (199 pass).

**Expiry (temporary `lifetime_minutes=2`, deploy #4)**: PASS
- POST todo-of-the-dead -> `r-f2ssub` alive 08:33:24, `expires_at` 08:35:24, schedule `at(2026-11-04T08:35:24)`. Autopsy `rules+llm`, 0 extras (absence-claim filter works).
- Reaper fired 08:36:08 (~44 s after the `at()` time; Scheduler is not second-exact). Log line: `{"event": "reaper", "id": "r-f2ssub", "result": "expired", "deleted": 8, "invalidation": "ICBF54...", "ms": 3957}`.
- Schedule deleted (ResourceNotFound); `aws s3 ls graves/r-f2ssub/` empty; live URL 404 with the "Rest in peace" page at 08:36:25; GET -> `expired`, "Returned to the grave"; badge "resting".
- Waited to GET until after the reaper ran, so the GET-time backstop could not mask a reaper failure.
- Restored `lifetime_minutes` to 20 (plan 0 add / 1 change / 0 destroy, only `LIFETIME_MINUTES` "2" -> "20"). Lambda env confirmed `20`; `terraform plan` shows no changes. The 2-minute window ran from deploy #4 until this restore.

## B3 final state

**Kill switch**: PASS. `resurrections_enabled=false` -> POST 503 `resurrections_disabled` (also with the admin header, and on retry); `/health` `resurrections_enabled:false`. Restored to true right after (plan 0/1/0, only that variable); env shows `true`, `LIFETIME_MINUTES=20`, `/health` true.
**Retry**: PASS. After the user fixed and pushed broken-potion, `POST /resurrections/r-80q9rm/retry` -> `attempt: 2`, `summoning`, ghost cleared, then `alive` (schedule `reap-r-80q9rm` at 11:53:30, 20 min). A plain POST also works again (201).
**Log scan** (last 4 h, `resurrect-api` and `resurrect-reaper`): 0 Traceback/ERROR/Exception lines; 0 hits for AKIA/ghp_/github_pat_/sk-/the admin token.

| Check | Result |
|---|---|
| Ghost (llm, names react-router-dom, `npm install react-router-dom`, 10 clean raw_tail lines) | PASS (after 3 fixes) |
| Autopsy summary `rules+llm` | PASS |
| Badge alive / unknown, no-cache headers | PASS |
| Expiry: schedule, reaper, S3 empty, 404 RIP, expired, log line | PASS |
| Pin / unpin / refuse non-alive | PASS |
| Rate limit (3x 201, 4th 429, admin ok) | PASS |
| Kill switch off/on | PASS |
| Retry -> attempt 2 -> alive | PASS |
| Log scan | PASS |

**Open issues**: Scheduler fires ~45 s after `at()`. Live sites left running: `r-80q9rm`, `r-ccs3zj` (expire in 20 min; older failed/test sites such as `r-qm4pxy` stay in S3 until the 2-day lifecycle). The tester's IP is rate-limited until the top of the hour from the 429 test; use `localStorage["resurrect.admin"]`.

**Next: merge to main at 6 PM.**

## B4 — backends (branch `feat/backends`)

### Phase 0 — Preflight: DONE
- Lambda account limit: `ConcurrentExecutions` 10, `UnreservedConcurrentExecutions` 10 (a quota increase to 1,000 has been requested). Below 100, so **no reserved concurrency anywhere**; `PutFunctionConcurrency` is not granted. Safety comes from a 30 s timeout on `rz-*` functions (Django's cold start needs it), the 20-minute TTL and `MAX_LIVE_BACKENDS` (default 2, env var).
- **BACKENDS_ENABLED must stay `false` in the demo unless the Lambda concurrency quota is above 100.** The API, the reaper and every awake backend share 10 slots, so a burst of backend traffic could throttle the API.
- Local Docker 29.9.3 (linux/x86_64) is available for Phase 3 checks. `resurrect-build` is not privileged, so a separate privileged project `resurrect-build-apps` is used and `resurrect-build` plus `buildspec/static-react.yml` stay byte-for-byte unchanged.

### Phase 1 — Infra: written, plan shown, not applied
Files: `infra/apps.tf` (new), `buildspec/backend-container.yml` (placeholder until Phase 3), `infra/lambda.tf` (env vars only), `infra/variables.tf` (`backends_enabled` "false", `max_live_backends` 2), `infra/outputs.tf` (`ecr_apps_uri`).
Plan: 10 to add, 3 to change, 0 to destroy; `fmt` and `validate` pass.

> **WARNING: Until `feat/backends` is merged, run `terraform apply` only from `feat/backends`. Applying from `feat/backend` or `main` will destroy the B4 resources.**

- Phase 1 is NOT applied. The Phase 1 apply, and everything else that changes AWS, waits for the merge of `feat/backend` (date to be decided, not 6 PM) AND an explicit "go" from the user. Until then: local code, tests and local Docker only.

### Phase 2 — Detection: DONE locally (nothing applied, no AWS calls)
**Files**: `app/detect.py` (new), `app/autopsy.py` (`analyze_ex`, `pick_app_dir`/`plan_fetch` take `backends`, second fetch round for entry modules), `app/models.py` (`BackendInfo`, `StoredRecord.backend`, both internal), `app/config.py` (`backends_enabled`, `max_live_backends`, `codebuild_apps_project`, `ecr_apps_uri`, `app_exec_role_arn`), `tests/test_detect.py` (49 tests).
**Check**: `env -u PYTHONPATH .venv/bin/python -m pytest -q tests` -> 248 passed (199 existing unchanged + 49 new).
- Covered: FastAPI in `main.py`, `app/main.py`, `backend/`, `src/main.py`, `api/main.py`; custom var name; first match wins; pyproject; no `app = FastAPI()` -> block with "Add `app = FastAPI()` in main.py"; Flask plain and `create_app` factory; Django with and without wsgi; Express with start script, port 5000 hard-coded, `main` field, default port; Fastify; Mongo app -> `warn` not block; SQLite -> `ok`; Next/Nest/Koa, Go, Ruby, Java, PHP stay blocked; frontend stacks unaffected.
- **Flag off**: all four backend kinds are `cannot_rise` exactly as before (`stack-python` / `stack-node-server`), and a repo with only `server/package.json` gives today's result (`unknown`, app_dir `.`, only `stack-unknown`, no extra fetches).
- **Flag on**: `backend/`, `server/`, `api/` are appended after the existing five, so a repo with both `frontend/` and `backend/` picks `frontend/` (React).

**Decisions**
- Node port: a literal `listen(5000)` -> adapter port 5000; `process.env.PORT` anywhere -> 8080 (we set `PORT=8080`); neither -> 3000 (the B4 default).
- `is_deployable` is NOT widened yet. With the flag on, a detected backend currently still ends as `cannot_rise`; Phase 4 wires `builds.start`, the state machine and `is_deployable` together so a half-wired backend can never start a static build.
- Backend detection only runs for the "python / node server" branches; Vite and CRA keep priority, so a React app that also lists express is still React.

**Next**: Phase 3 (buildspec) is code-only and can proceed locally; Phase 1 apply and all live checks wait for the merge and an explicit "go".

### Phase 3 — Build (buildspec): DONE locally (no AWS)
**Files**: `buildspec/backend-container.yml` (the block that `resurrect-build-apps` runs), `scripts/local_backend_build.sh` (runs that exact block locally, then `docker run` + curl), `backend/tests/fixtures/apps/{fastapi-sqlite,flask-factory,django-min,express-5000}/`, `tests/test_buildspec.py`. `buildspec/static-react.yml` and `infra/codebuild.tf` are byte-for-byte unchanged (a test asserts the former).
**Checks** (Docker 29.9.3 local, containers run `--read-only --tmpfs /tmp --user 1000:1000` to mimic Lambda):
- YAML parses; the block passes `bash -n`.
- FastAPI (relative `notes.db`): `/docs` 200; `POST /notes` then `GET /notes` returns `["hello"]`, so SQLite in `/tmp/app` works on a read-only filesystem.
- Flask factory (`"app:create_app()"`): 200. Django (migrate + generated `resurrect_settings.py`, ALLOWED_HOSTS `*`): `/` 200, `/admin/login/` 200. Express with `listen(5000)` and `npm start`: 200 on 5000.
- Test suite: 262 passed (new: `test_buildspec.py`, 14 tests: syntax, inputs rejected before cloning, security assertions).

**Bugs found by running it for real**
- buildx added a provenance/SBOM attestation index to the image. Lambda rejects image indexes, so the buildspec sets `BUILDX_NO_DEFAULT_ATTESTATIONS=1` (ignored by Docker versions without buildx).
- A Dockerfile `ENV` value strips double quotes, which broke the Flask factory entry (`"app:create_app()"`). The entry is now escaped for the Dockerfile.

**Security notes**
- Student `pip`/`npm` runs inside `docker build`. The build container could otherwise reach the CodeBuild role credentials at `169.254.170.2`, so the buildspec first adds `iptables -I DOCKER-USER ... -j DROP` for `169.254.170.2` and `169.254.169.254`. **This cannot be tested locally and must be verified in Phase 5** (a test repo whose install step tries to curl the credentials endpoint must fail). Even if it leaked, that role can only push to `resurrect-apps`.
- `RES_ID`, `RUNTIME`, `APP_PORT`, `ENTRY`, `DJANGO_PROJECT` and `APP_DIR` are regex-validated before anything is written or run; detection also only accepts identifier-shaped Django project names.
- Only `public.ecr.aws` images are pulled (no Docker Hub limits). Slim images have no compiler, so Python packages that need to build from source will fail to install; that becomes a ghost.
- The 169.254 DROP rules need `iptables` in the CodeBuild image; if the rules fail, the build fails (fail closed).

### Phase 4 — Deploy, state machine, pulse, reaper: DONE locally (fake AWS; nothing applied)
**Files**: `app/functions.py` (new), `app/pulse.py` (`probe_backend`), `app/statemachine.py`, `app/service.py` (live cap), `app/builds.py` (project by backend), `app/reaper.py`, `app/autopsy.py` (`is_deployable(autopsy, backend)`), `app/models.py` (`function_url`, `function_created_at`), `app/scrub.py`, `infra/apps.tf` (+`lambda:GetFunctionUrlConfig`; API may also `BatchDeleteImage` and `DeleteLogGroup` for failed apps), `tests/test_backends.py` (25 tests).
**Check**: `pytest tests` -> **287 passed** (the 199 B3 tests are unchanged and pass), also with AWS credentials unset. `terraform fmt -check` and `validate` pass. `static-react.yml`, `codebuild.tf`, `contracts/`, `frontend/` have no diff.

**How it works (backend stacks only; the static path is untouched)**
- `builds.start(..., backend=info)` uses `resurrect-build-apps` with `RUNTIME/ENTRY/APP_PORT/DJANGO_PROJECT/ECR_APPS_URI` (no `BUCKET`); otherwise exactly as before.
- CodeBuild `SUCCEEDED` -> stays `building`, `phase_message` "Raising the server", `functions.create` (log group + 1-day retention first, `rz-<id>`: image, 1024 MB, **30 s**, 1024 MB ephemeral, x86_64, tag `resurrect-id`; Function URL AuthType NONE + both public permissions; every step tolerates `ResourceConflict`, so a lost race re-running it is harmless). **No reserved concurrency anywhere** (account limit is 10).
- Each GET: `Active` -> `checking_pulse`; `Failed`/missing -> `failed` with a ghost that includes `StateReasonCode` and reason; `Pending` for 3 minutes -> `failed`.
- Pulse: `/health`, `/docs` (or `/openapi.json`), `/`, plus `/admin/` for Django, first answer below 500 wins. 90 s deadline (static stays 60 s), max 20 attempts. A timeout stops the poll's probing, and a 403 `Forbidden` (a Function URL with no public permission) never counts as alive.
- Failure ghost = probe results + the last 50 lines of `/aws/lambda/rz-<id>`, scrubbed. A failed backend is cleaned up at once (function, image, log group) so it does not hold a live slot.
- `live_url` = function URL + `/docs` for FastAPI (otherwise the URL itself). Expiry/pin unchanged (same schedule, 20 minutes).
- Reaper: for backend records (and unknown ids) also deletes the function (and URL), the image tag and the log group; NotFound ignored; second run is a no-op. Static records never touch Lambda, ECR or Logs.
- Live cap `MAX_LIVE_BACKENDS` (env var, default **2**): counted with `ListFunctions` on the `rz-` prefix before any build or quota use. Over the cap: `cannot_rise` with the finding "Too many backends are awake right now; try again in a few minutes." (id `too-many-backends`, no contract change).
- Flag off: the autopsy never yields backend info, so no Lambda/ECR/Logs client is touched (test fails if one is requested).

**Bug found by the tests**: connection strings such as `mongodb://admin:hunter2@host` were not redacted (the key `MONGO_URL` does not contain "secret/token/password"). `scrub` now redacts the password in any `scheme://user:pass@host`. Matters most for the DB-failure ghosts.

**Open issues / for Phase 5 (all need "go")**
- Verify in the real CodeBuild project that the `iptables` DROP rules work and that a test repo cannot read the CodeBuild credentials during `docker build`.
- Verify that Lambda accepts the image (single-manifest) and that the adapter readiness settings let a 404 on `/` count as ready.
- `ListFunctions` is account-wide (cannot be scoped); the API only reads names with the `rz-` prefix.
- `terraform apply` will change the API and reaper code hashes (new code), unlike the earlier env-only diff. The Phase 1 apply still waits for the merge and an explicit "go".
- Account concurrency is 10 until the quota increase lands: keep `BACKENDS_ENABLED=false` for the demo unless it is above 100.

**Next**: Phase 5 (live verification) needs the merge and "go". Remaining local-only work: none planned; I can write the five test repos in `~/resurrect-test-repos/` now if you want them ready.

### Preflight and flag-off checks (2026-11-05, `BACKENDS_ENABLED=false`, nothing applied)
**Preflight**
- Lambda concurrency quota (`L-B99A9384`): **10**. Increase to **1000 filed 2026-11-05 08:49 IST, status PENDING**. Flag stays off until it is approved and the quota is above 100.
- `scripts/package_backend.sh` + `terraform plan` (not applied): **0 add, 5 change, 0 destroy**, not the expected "no changes".
  - `aws_lambda_function.api` and `.reaper`: `source_code_hash` only. The live `app/` is **byte-identical** to `backend/app` (`diff -rq`, exit 0, checked twice), so this is zip/wheel non-reproducibility, not a code change. It includes the `requestContext.http.sourceIp` fix (`main.py:59`) and the ghost command allowlist (`ghost.py`).
  - `aws_codebuild_project.build_apps`: buildspec differs by `docker build --progress=plain` (repo has it, live project does not).
  - `aws_iam_role_policy.api_apps` and `.scheduler`: policy shown as "known after apply" (deferred; content not proven different).
- pytest: **290 passed**.
- Failed backend reads the last 50 lines of `/aws/lambda/rz-<id>` before cleanup: `statemachine.py:82` (`app_logs`) precedes `statemachine.py:87` (`cleanup`); test `test_backends.py::test_failed_backend_reads_last_50_log_lines_before_deleting_the_log_group`.

**Test repos** (public, `NeerajaSurati-265`): haunted-portfolio, rz-fastapi-sqlite, rz-flask, rz-django, rz-express (listen 5000 + `postinstall` creds probe), rz-express-mongo.

**Flag-off live checks (admin header, token read from SSM, not printed)**
| Repo | id | Result |
|---|---|---|
| haunted-portfolio | r-nj7jyf | `alive` at **56.1 s** from POST (client clock; under 60 s but thin margin). Index 200, `style.css` 200 `text/css`. Stack `static`. |
| todo-of-the-dead | r-p0gven | `alive` at **50.3 s**. Stack `react-vite`. `assets/index-FHbrDV5y.js` 200 `text/javascript`, CSS 200. |
| rz-fastapi-sqlite | r-9o92a7 | `cannot_rise` at once (3.5 s), stack `python`, finding `stack-python`. CodeBuild: `resurrect-build` 18 before/after, `resurrect-build-apps` 0 before/after, **no build started**. |
- Nothing pinned. The two live sites expire after 20 minutes.
- Waiting for the user before Step 5 (flag on).

### Step 5 — flag ON, live checks and test matrix (2026-11-05; `BACKENDS_ENABLED=true`, `MAX_LIVE_BACKENDS=2`, quota 10)
Applied the saved flag-on plan (0 add, 5 change, 0 destroy; flag + known drift). Admin header on every POST. Lambda `Throttles` (account-wide and `resurrect-api`, 1-minute periods) was **0 after every run and over the whole session**. Never more than 2 `rz-*` alive; each alive backend was reaped through the real `resurrect-reaper` before the next test. Quota request status is `CASE_OPENED` (value still 10). **Nothing was fixed; the flag is still ON.**

**Part 1 checks**
| Check | Result |
|---|---|
| rz-fastapi-sqlite | alive 74.7 s; `/docs`, `/health`, `/openapi.json` 200; POST+GET `/notes` OK on read-only FS |
| rz-flask | alive 64.5 s, `/` 200 (served by an older `app/` package in the repo, see note) |
| rz-express | alive 69.2 s. **Build log shows `CREDS_BLOCKED` inside `docker build`: the iptables DROP rules work in the real CodeBuild project** |
| live cap | with 2 alive, rz-django -> `cannot_rise` in 3.5 s, finding `too-many-backends`, `resurrect-build-apps` count unchanged |
| rz-django (alone) | alive 68.1 s; `/` 200, `/admin/login/` 200 (no DisallowedHost) |
| rz-express-mongo | failed after **172.1 s**; ghost names the refused connection to 127.0.0.1:27017; function, image tag, log group all gone |
| static regression, flag on | haunted-portfolio alive 54.4 s, style.css 200; todo-of-the-dead alive 58.7 s, JS/CSS/favicon 200; no Lambda/ECR created |
| cleanup audit | 0 `rz-*` functions, 0 ECR tags, 0 `/aws/lambda/rz-` log groups. 7 `reap-*` schedules remain (static sites expiring, plus 2 already-reaped backends that will fire as no-ops) |

**Matrix** (expected / actual)
| Repo | Category | Expected | Actual | Time | Result | Notes |
|---|---|---|---|---|---|---|
| NeerajaSurati-265/haunted-portfolio | static | alive | alive | 54.4 s | PASS | style.css 200 |
| transfershadiii/portfolio | static | alive | alive | 53.6 s | PASS | index, about, contact, media/images.png, style.css all 200 |
| atharvjain1114-avj14/Portfolio-HTML-CSS | static | alive | cannot_rise (`stack-unknown`) | 3.0 s | **BUG** | Only page is `Profileproject NEW.html`, no `index.html`. Message is "Unrecognised project. Static HTML and React apps can rise today." Never says "rename it to index.html" |
| NeerajaSurati-265/todo-of-the-dead | react (Vite) | alive | alive | 58.7 s | PASS | JS/CSS/favicon 200 |
| aman-verma/viteReactTodo | react (Vite) | alive | alive | 68.4 s | PASS | assets 200 |
| tanish-1/ViteReactTodoList | react (Vite+Tailwind) | alive | alive | 61.0 s | PASS | assets 200 |
| NeerajaSurati-265/broken-potion | broken | failed | not tested | - | N/A | already fixed (lists react-router-dom) |
| NeerajaSurati-265/broken-potion-2 | broken | failed + useful ghost | failed | 38.2 s | PASS | Ghost names `react-router-dom` and gives `npm install react-router-dom` |
| NeerajaSurati-265/rz-flask | backend | alive | alive | 64.5 s | PASS | |
| NeerajaSurati-265/rz-express | backend | alive | alive | 69.2 s | PASS | CREDS_BLOCKED |
| troubleshooteriitm/fastapi_crud_sqlite | backend | alive or clear block | cannot_rise (`stack-unknown`) | 3.0 s | **BUG** | App is `backend/app/main.py` but the repo has no requirements.txt/pyproject. Message is the generic "Unrecognised project"; should say "FastAPI app found, add requirements.txt" |
| Gabrielgsn30/fastapi_crud | backend | alive | failed | 32.9 s | **BUG** | Cause right (old pin `greenlet` has no wheel for py3.12, needs gcc). Fix is wrong for a student: "Install gcc by adding it to your Dockerfile". Real fix: loosen/upgrade the pinned versions |
| eeeeaa/express-api-tutorial | backend | alive | failed | **228.9 s** | **BUG** (time) | Ghost right (`start` runs `nodemon`, a devDependency: "nodemon: not found"), fix "Install nodemon as a dependency" is acceptable. Took almost 4 minutes to say so |
| NeerajaSurati-265/rz-express-mongo | database | failed + useful ghost | failed | **172.1 s** | PASS (slow) | Cause right. Fix "Check MongoDB service is running or use a cloud MongoDB URI" is weak: "service is running" does not apply on Lambda |
| Huzaifa-io/express-postgres-crud-api | database | alive/warn | alive | 64.2 s | PASS, note | `db-external` warn is accurate. `GET /` is 404 and every DB route would fail, so the live link shows a bare 404 |
| weijunext/nextjs-starter | unsupported | cannot_rise | cannot_rise | 3.8 s | **BUG** (copy) | Says "Resurrect only hosts static files today" and "Server apps arrive in a later version", which is false with the flag on (Express works). LLM summary says "It should build successfully"; the LLM lockfile fix says `pnpm install` while the rule says npm |
| iamvickyav/spring-boot-data-H2-embedded | unsupported | cannot_rise | cannot_rise (`stack-unknown`) | 2.9 s | **BUG** (low) | "Unrecognised project" never names Java/Spring or says it is unsupported |

Other notes: the FastAPI autopsy includes an LLM "SQL injection" finding on SQLAlchemy ORM code (false positive); Django shows LLM findings "ALLOWED_HOSTS is empty" and "debug mode" although the buildspec overrides both. `rz-flask`: my `app.py` is shadowed by an older `app/__init__.py` package already in that folder (so the repo works but has dead code).

**BUGs, ranked by how likely a judge hits them**
1. **Broken backends take 3-4 minutes to report failure** (Mongo 172 s, Express/nodemon 229 s; a broken static/React build takes 38 s). Any judge who tries a bad backend watches a spinner for minutes. *Fix*: in `statemachine`, treat `INIT_REPORT ... Status: error` / `Runtime.ExitError` in `functions.app_logs` (or a first 502 from the probe) as a failure after one or two probes instead of the full 90 s deadline; cap the backend pulse at about 45 s; fetch the ghost right away.
2. **Wrong fix for old pinned Python packages** ("add gcc to your Dockerfile"). Pinned `requirements.txt` files from old tutorials are very common. *Fix*: add a ghost rule/prompt hint: when the log shows `Failed building wheel`/`gcc` for pinned versions, say "These pinned versions need compiling. Upgrade them (or remove the `==` pins) in requirements.txt", never mention a Dockerfile; or build wheels in a gcc builder stage so it just works.
3. **Next.js / server apps copy is stale and contradictory** (judges often try Next.js). *Fix*: with the flag on, change `stack-node-server` text to name the framework ("Next.js is not supported yet; Vite React, plain HTML, FastAPI, Flask, Django and Express are") and drop "only hosts static files"; drop the LLM lockfile/"should build" findings when the rule verdict is `block`.
4. **Static site without `index.html`** gets the generic "Unrecognised project". *Fix*: if the repo has `.html` files but no `index.html`, show "Rename `X.html` to `index.html`", or serve the single HTML file automatically.
5. **Python app without requirements.txt** (also nested like `backend/app/main.py`). *Fix*: when a FastAPI/Flask import is found but no requirements/pyproject exists, say "Add requirements.txt (fastapi, uvicorn...)".
6. **Alive backend whose `/` is 404** shows a bare 404 as the live link. *Fix*: pick `/docs`, `/health` or the first probe path that answered 2xx/3xx as `live_url`, else note "API only: try /<path>".
7. **Unsupported-language copy** (Java/Go/Ruby/PHP) should name the language. *Fix*: per-language block message.
8. **Mongo ghost wording**: say "Lambda cannot run MongoDB; use MongoDB Atlas and set the connection string as an env var". *Fix*: prompt hint for `ECONNREFUSED 27017`.
9. Low: misleading LLM findings (ORM SQL-injection false positive, Django ALLOWED_HOSTS/debug) should be dropped when the build overrides them.

State at the end: flag **ON**, quota 10, 0 live `rz-*`. Waiting for the user on which fixes to make and when to set the flag back to false.

### Matrix fixes, bugs 1-5, 7, 8 (local only: code + tests + package; nothing applied, no AWS calls)
**Files**: `app/functions.py` (`crash_line`), `app/statemachine.py`, `app/ghost.py` (`rule_ghost`, prompt), `app/detect.py`, `app/autopsy.py`, `tests/test_fixes.py` (56 new), one old test in `tests/test_backends.py` updated for the new deadline. **Check**: `pytest tests` -> **346 passed** (290 + 56), also with AWS credentials unset. `scripts/package_backend.sh` built `build/api.zip` (local sha256 `nAfcirDbmmFEpxB1q6slunFjcouS9+7iDVV7NpyZe2c=`). Mutation check: disabling crash detection fails the fail-fast test.
- **1 Fail fast**: after a failed probe the backend path reads the app's logs once; `Runtime.ExitError` / `Runtime.Unknown|InvalidEntrypoint|ImportModuleError` / `INIT_REPORT ... Status: error` -> `failed` ("The server crashed") on that poll, ghost built from those same lines, function cleaned up. Otherwise the pulse deadline for backends is **45 s** (was 90). Slow-but-alive apps and one-request tracebacks do not count as crashes. Static keeps 60 s and never reads Lambda logs.
- **2, 8 Ghost copy**: deterministic ghosts (no model call) for (a) `Failed building wheel for X` / `Could not build wheels for X` / `No matching distribution found for X==` -> "upgrade X or remove the == pins in requirements.txt", never a Dockerfile; (b) a refused connection to localhost:27017/5432/3306 -> "use a hosted database such as MongoDB Atlas / Neon or Supabase and read its URL from an env var". Model prompt also forbids Dockerfile advice and knows both cases. `db-external` finding detail/fix use the same wording per database.
- **3, 7 Names**: with the flag on, Next.js/NestJS/Koa are named and the supported list is current ("static sites, React (Vite or Create React App), FastAPI, Flask, Django and Express apps"); Java/Spring, Go, Ruby, PHP, Rust, C# are named too (flag off lists only static and React). When any rule blocks, the autopsy uses the rules summary only: no model summary, no model warnings, `source: "rules"`.
- **4**: `.html` pages in the app folder but no `index.html` -> block `no-index-html`, fix "Rename your main page to index.html." (both flags, stack `static`).
- **5**: flag on, no requirements.txt/pyproject: the autopsy fetches likely entry files (`main.py`, `app.py`, `backend/app/main.py`, ...) and a FastAPI/Flask app gives block `python-no-requirements` ("Found a FastAPI app in ..., add requirements.txt").
- **Flag off is unchanged** for node-server copy, `stack-python`, python-without-requirements and the file fetch (tests assert it).
- **Contract notes**: `Ghost.source` only allows `llm|fallback` (frozen), so rule ghosts say `llm` (the UI shows `fallback` as a generic ghost). Blocked autopsies now say `source: "rules"`, which the UI captions "rules only (the AI review was unavailable)".
- **Not run**: `terraform plan` (it refreshes against AWS). Expected diff once run: `api` and `reaper` `source_code_hash` only (plus the known drift items); no flag change.
- **Applied** (user OK, saved plan `-var backends_enabled=true`): plan said 3 change; result **0 added, 2 changed, 0 destroyed** (`api` and `reaper` `source_code_hash`). The `scheduler` policy was Terraform noise and did not change. Live `CodeSha256` is `nAfcirDbmmFEpxB1q6slunFjcouS9+7iDVV7NpyZe2c=`; `BACKENDS_ENABLED=true`, `MAX_LIVE_BACKENDS=2`, `/health` OK. Flag still ON, quota 10.
