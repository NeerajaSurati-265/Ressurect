// FROZEN. Source of truth for API shapes.

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
