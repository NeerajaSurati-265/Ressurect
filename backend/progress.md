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
