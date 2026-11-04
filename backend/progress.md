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
