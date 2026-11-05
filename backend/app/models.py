"""Pydantic models. Public models mirror contracts/types.ts exactly (snake_case, nulls kept)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel

ResurrectionStatus = Literal[
    "summoning", "building", "checking_pulse", "alive", "failed", "cannot_rise", "expired"
]
Stack = Literal["static", "react-vite", "react-cra", "node-other", "python", "unknown"]
Severity = Literal["ok", "warn", "block"]

TERMINAL_STATUSES = {"alive", "failed", "cannot_rise", "expired"}
POLLING_STATUSES = {"summoning", "building", "checking_pulse"}


class Finding(BaseModel):
    id: str
    severity: Severity
    title: str
    detail: str
    fix: Optional[str] = None
    file: Optional[str] = None


class Autopsy(BaseModel):
    verdict: Literal["healthy", "warnings", "blocked"]
    stack: Stack
    app_dir: str
    summary: str
    findings: List[Finding]
    source: Literal["rules+llm", "rules"]


class Ghost(BaseModel):
    cause: str
    fix: str
    command: Optional[str] = None
    confidence: Literal["high", "medium", "low"]
    source: Literal["llm", "fallback"]
    raw_tail: List[str]


class RepoRef(BaseModel):
    owner: str
    name: str
    url: str
    default_branch: str
    commit_sha: Optional[str] = None


class Pulse(BaseModel):
    attempts: int
    max_attempts: int


class Resurrection(BaseModel):
    id: str
    repo: RepoRef
    status: ResurrectionStatus
    stack: Stack
    deployable: bool
    attempt: int
    phase_message: str
    autopsy: Autopsy
    ghost: Optional[Ghost] = None
    live_url: Optional[str] = None
    badge_markdown: Optional[str] = None
    pinned: bool = False
    pulse: Optional[Pulse] = None
    created_at: str
    alive_at: Optional[str] = None
    expires_at: Optional[str] = None
    server_time: str


class LogLine(BaseModel):
    ts: str
    text: str
    kind: Literal["build", "pulse", "system"]


class LogsResponse(BaseModel):
    lines: List[LogLine]
    cursor: Optional[str] = None
    done: bool


class ApiErrorBody(BaseModel):
    code: str
    message: str
    retry_after_s: Optional[int] = None


class ApiError(BaseModel):
    error: ApiErrorBody


class CreateResurrectionRequest(BaseModel):
    repo_url: str


class BackendInfo(BaseModel):
    """Internal build/run facts for a backend app. Never part of the public API."""

    framework: str                    # fastapi | flask | django | express | fastify
    runtime: str                      # python | node
    entry: str                        # shell command that starts the app
    app_port: int                     # port the app listens on inside the container
    live_path: str = ""               # appended to the function URL (e.g. "/docs")
    probe_paths: List[str] = []
    django_project: Optional[str] = None
    uses_sqlite: bool = False
    has_build_script: bool = False


class FullstackInfo(BaseModel):
    """B5: a React frontend plus a supported backend from one repo. Internal, never in the API."""

    frontend_dir: str
    backend_dir: str
    frontend_stack: str                # react-vite | react-cra
    backend: BackendInfo
    wiring_kind: str                   # env | localhost | proxy | unsupported | none
    env_names: List[str] = []
    localhost_urls: List[str] = []     # exact origins, e.g. http://localhost:8000
    unsupported_names: List[str] = []  # API-looking env names the build cannot set (NEXT_PUBLIC_*, ...)
    app_cors: bool = False             # the backend configures its own CORS


class StoredRecord(BaseModel):
    """What lives in DynamoDB: the public record plus internal bookkeeping."""

    res: Resurrection
    build_id: Optional[str] = None
    log_stream: Optional[str] = None
    pulse_started_at: Optional[str] = None
    last_probe_at: Optional[str] = None
    pulse_lines: List[LogLine] = []
    client_ip: Optional[str] = None
    package_json: Optional[str] = None  # trimmed copy for the error ghost
    backend: Optional[BackendInfo] = None  # B4: how to build and run a backend app (internal)
    function_url: Optional[str] = None      # B4: the rz-<id> Function URL once created
    function_created_at: Optional[str] = None
    fullstack: Optional[FullstackInfo] = None  # B5: both halves of a full-stack repo (internal)
    fe_build_id: Optional[str] = None
    fe_log_stream: Optional[str] = None
    fe_pulse_offset: Optional[int] = None
    fs_stage: Optional[str] = None          # backend | backend_pulse | frontend | frontend_pulse
    quota_slot_pk: Optional[str] = None     # counter holding the frontend build's reserved slot
    version: int = 0

    def to_api(self, server_time: str) -> dict:
        """The API response: public fields only, nulls included."""
        data = self.res.model_copy(update={"server_time": server_time})
        return data.model_dump(mode="json")
