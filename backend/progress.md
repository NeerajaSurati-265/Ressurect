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
