# API contract

Source for `contracts/api.md` and `contracts/types.ts`. Frozen after the Prompt 0 commit: neither person
changes it without telling the other. All JSON keys are snake_case, all times are ISO 8601 UTC
strings ending in Z.

## URL shapes
- Resurrect app: `https://<ui-domain>/` and `https://<ui-domain>/r/<id>`
- Live student site: `https://<graves-domain>/<id>/` (S3 key `graves/<id>/...`)
- Badge: `<api-url>/badge/<id>.svg`, linking to `https://<ui-domain>/r/<id>`
- Dead link: any missing path on the graves domain shows `graves/_rip/index.html` with status 404

## Endpoints
Optional header on POST and retry: `X-Resurrect-Admin: <token>` skips the IP limit and daily quota
(not the kill switch).

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| POST /resurrections | Body `{"repo_url": string}`. Runs the autopsy, starts a build if not blocked. | 201 Resurrection | 400 invalid_url, 404 repo_not_found, 422 repo_too_large, 429 rate_limited / quota_exhausted, 503 resurrections_disabled |
| GET /resurrections/{id} | Current record. Each call also advances the state machine. | 200 Resurrection | 404 not_found |
| GET /resurrections/{id}/logs?cursor= | Log lines after cursor (omit for the first call). | 200 LogsResponse | 404 not_found |
| POST /resurrections/{id}/retry | Only from failed. Re-runs autopsy and build at the latest commit. | 200 Resurrection | 409 not_retryable, plus the POST errors |
| GET /badge/{id}.svg | README badge, `Cache-Control: no-cache`. | 200 SVG | 404 SVG saying "unknown" |
| GET /health | `{"ok": true, "resurrections_enabled": bool}` | 200 | — |

## Status values
The frontend polls `GET /resurrections/{id}` and the logs endpoint every 2 s while status is
`summoning`, `building` or `checking_pulse`, and stops on any other status.

| Status | Meaning | Terminal? |
|---|---|---|
| summoning | Build queued or provisioning | No |
| building | CodeBuild running (`phase_message` says which step) | No |
| checking_pulse | Build succeeded; probing the live URL | No |
| alive | Live; `live_url` and `expires_at` set (`expires_at` null if pinned) | Until expiry |
| failed | Build or pulse failed; `ghost` set | Yes (retryable) |
| cannot_rise | Autopsy blocked; no build ran | Yes |
| expired | Lifetime over, files deleted | Yes |

## Types (contracts/types.ts)
```ts
export type ResurrectionStatus =
  | "summoning" | "building" | "checking_pulse"
  | "alive" | "failed" | "cannot_rise" | "expired";

export type Stack =
  | "static" | "react-vite" | "react-cra"
  | "node-other" | "python" | "unknown";

export type Severity = "ok" | "warn" | "block";

export interface Finding {
  id: string;            // stable slug, e.g. "no-build-script"
  severity: Severity;
  title: string;         // short, plain English
  detail: string;        // one or two sentences
  fix: string | null;    // one concrete action
  file: string | null;   // e.g. "package.json"
}

export interface Autopsy {
  verdict: "healthy" | "warnings" | "blocked";
  stack: Stack;
  app_dir: string;       // "." or e.g. "frontend"
  summary: string;       // 1-2 sentences
  findings: Finding[];
  source: "rules+llm" | "rules";
}

export interface Ghost {
  cause: string;
  fix: string;
  command: string | null;
  confidence: "high" | "medium" | "low";
  source: "llm" | "fallback";
  raw_tail: string[];    // last log lines, secrets redacted
}

export interface RepoRef {
  owner: string;
  name: string;
  url: string;           // https://github.com/owner/name
  default_branch: string;
  commit_sha: string | null;
}

export interface Pulse {
  attempts: number;
  max_attempts: number;
}

export interface Resurrection {
  id: string;            // "r-" + 6 chars [a-z0-9]
  repo: RepoRef;
  status: ResurrectionStatus;
  stack: Stack;
  deployable: boolean;
  attempt: number;       // starts at 1
  phase_message: string; // e.g. "Installing dependencies"
  autopsy: Autopsy;
  ghost: Ghost | null;
  live_url: string | null;
  badge_markdown: string | null;
  pinned: boolean;
  pulse: Pulse | null;
  created_at: string;
  alive_at: string | null;
  expires_at: string | null;
  server_time: string;   // for countdown clock sync
}

export interface LogLine {
  ts: string;
  text: string;
  kind: "build" | "pulse" | "system";
}

export interface LogsResponse {
  lines: LogLine[];
  cursor: string | null; // pass back on the next call
  done: boolean;         // true once status is terminal and no lines remain
}

export type ErrorCode =
  | "invalid_url" | "repo_not_found" | "repo_too_large"
  | "rate_limited" | "quota_exhausted" | "resurrections_disabled"
  | "not_found" | "not_retryable" | "internal";

export interface ApiError {
  error: { code: ErrorCode; message: string; retry_after_s: number | null };
}

export interface CreateResurrectionRequest {
  repo_url: string;
}
```

## Example: a record that just came alive
```json
{
  "id": "r-k3m9qa",
  "repo": {"owner": "rahul", "name": "todo-of-the-dead", "url": "https://github.com/rahul/todo-of-the-dead", "default_branch": "main", "commit_sha": "9f2c1e7"},
  "status": "alive",
  "stack": "react-vite",
  "deployable": true,
  "attempt": 1,
  "phase_message": "It lives",
  "autopsy": {"verdict": "warnings", "stack": "react-vite", "app_dir": ".",
    "summary": "A Vite React app that should build; it has no lockfile, so installs may drift.",
    "findings": [
      {"id": "stack-detected", "severity": "ok", "title": "React app built with Vite", "detail": "package.json has a build script and depends on vite.", "fix": null, "file": "package.json"},
      {"id": "no-lockfile", "severity": "warn", "title": "No lockfile", "detail": "Without package-lock.json, npm may install newer versions than you tested.", "fix": "Run npm install and commit package-lock.json.", "file": null}
    ],
    "source": "rules+llm"},
  "ghost": null,
  "live_url": "https://d2abc.cloudfront.net/r-k3m9qa/",
  "badge_markdown": "[![Resurrected](https://xyz.lambda-url.us-east-1.on.aws/badge/r-k3m9qa.svg)](https://d1ui.cloudfront.net/r/r-k3m9qa)",
  "pinned": false,
  "pulse": {"attempts": 2, "max_attempts": 20},
  "created_at": "2026-11-04T07:30:02Z",
  "alive_at": "2026-11-04T07:32:41Z",
  "expires_at": "2026-11-04T07:52:41Z",
  "server_time": "2026-11-04T07:32:43Z"
}
```

## Mock scenarios (contracts/mock-scenarios.json)
The frontend mock replays these so every screen works without the backend. Each scenario is a list
of frames `{"at_ms": number, "patch": Partial<Resurrection>, "log_lines": LogLine[]}` applied in order
to a base record.

| Scenario | Picked when the repo URL contains | Story |
|---|---|---|
| alive | anything else | react-vite repo, autopsy with one warning, ~25 log lines over ~20 s, pulse attempt 1 fails and 2 passes, alive with a 20-minute expiry |
| ghost | broken | broken react-vite repo, build fails with Cannot find module 'react-router-dom', ghost explains it, retry plays the alive story |
| cannot_rise | api or python | FastAPI repo, autopsy blocked with 3 findings, no build |
| HTTP 429 | greedy | POST returns rate_limited with `retry_after_s: 1800` |
