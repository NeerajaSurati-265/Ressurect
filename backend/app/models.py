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
    version: int = 0

    def to_api(self, server_time: str) -> dict:
        """The API response: public fields only, nulls included."""
        data = self.res.model_copy(update={"server_time": server_time})
        return data.model_dump(mode="json")
