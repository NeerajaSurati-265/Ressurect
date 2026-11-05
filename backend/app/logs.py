"""Build logs from CloudWatch: strip ANSI, hide ::resurrect:: markers, derive phase messages."""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from . import config
from .models import LogLine, StoredRecord
from .timeutil import from_ms

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
MARKER = "::resurrect::"
PHASE_RE = re.compile(r"phase=(\w+)")
PHASE_MESSAGES = {
    "cloning": "Cloning the grave",
    "installing": "Installing dependencies",
    "building": "Building",
    "uploading": "Uploading the remains",
}  # "done" leaves the message unchanged


@dataclass
class LogsPage:
    lines: List[LogLine] = field(default_factory=list)
    cursor: Optional[str] = None
    new_events: bool = False
    phase_message: Optional[str] = None


def strip_ansi(text: str) -> str:
    return ANSI.sub("", text)


def parse_events(events: List[dict]) -> Tuple[List[LogLine], Optional[str]]:
    """Visible build lines plus the latest real marker's phase message (if any)."""
    lines: List[LogLine] = []
    phase_message: Optional[str] = None
    for event in events:
        ts = from_ms(event["timestamp"])
        for raw in strip_ansi(event.get("message", "")).splitlines():
            text = raw.rstrip()
            if not text.strip():
                continue
            if MARKER in text:
                # Only a line that STARTS with the marker is real; echoed command text is hidden too.
                if text.lstrip().startswith(MARKER):
                    m = PHASE_RE.search(text)
                    if m and m.group(1) in PHASE_MESSAGES:
                        phase_message = PHASE_MESSAGES[m.group(1)]
                continue
            lines.append(LogLine(ts=ts, text=text, kind="build"))
    return lines, phase_message


def encode_cursor(token: Optional[str], pulse_seen: int, token2: Optional[str] = None) -> str:
    data = {"t": token, "p": pulse_seen}
    if token2 is not None:  # full-stack only; single-build cursors stay byte-identical to before
        data["t2"] = token2
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor_full(cursor: Optional[str]) -> Tuple[Optional[str], int, Optional[str]]:
    if not cursor:
        return None, 0, None
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        return data.get("t"), max(0, int(data.get("p", 0))), data.get("t2")
    except Exception:
        return None, 0, None


def decode_cursor(cursor: Optional[str]) -> Tuple[Optional[str], int]:
    token, pulse_seen, _ = decode_cursor_full(cursor)
    return token, pulse_seen


def _not_found(exc: Exception) -> bool:
    return (getattr(exc, "response", None) or {}).get("Error", {}).get("Code") == "ResourceNotFoundException"


def _read_stream(stream: Optional[str], token: Optional[str]):
    """(events, next_token) of one build stream; nothing yet if the stream does not exist."""
    if not stream:
        return [], token
    kwargs = dict(logGroupName=config.settings().log_group, logStreamName=stream, startFromHead=True)
    if token:
        kwargs["nextToken"] = token
    try:
        resp = config.client("logs").get_log_events(**kwargs)
    except Exception as exc:
        if not _not_found(exc):
            raise
        return [], token
    return resp.get("events", []), resp.get("nextForwardToken", token)


def fetch_fullstack(rec: StoredRecord, cursor: Optional[str]) -> LogsPage:
    """Both builds in order: backend lines, pulse lines up to the hand-over, frontend lines, the rest."""
    t1, pulse_seen, t2 = decode_cursor_full(cursor)
    ev1, n1 = _read_stream(rec.log_stream, t1)
    ev2, n2 = _read_stream(rec.fe_log_stream, t2)
    be_lines, be_phase = parse_events(ev1)
    fe_lines, fe_phase = parse_events(ev2)
    new_pulse = rec.pulse_lines[pulse_seen:]
    cut = len(rec.pulse_lines) if rec.fe_pulse_offset is None else rec.fe_pulse_offset
    before = [ln for i, ln in enumerate(rec.pulse_lines) if pulse_seen <= i < cut]
    after = [ln for i, ln in enumerate(rec.pulse_lines) if i >= max(pulse_seen, cut)]
    return LogsPage(
        lines=be_lines + before + fe_lines + after,
        cursor=encode_cursor(n1, len(rec.pulse_lines), n2 if n2 is not None else ""),
        new_events=bool(ev1) or bool(ev2) or bool(new_pulse),
        phase_message=fe_phase or be_phase,
    )


def fetch(rec: StoredRecord, cursor: Optional[str]) -> LogsPage:
    """One page of new lines since `cursor`. Before the stream exists: no lines, same cursor."""
    if rec.fullstack is not None:
        return fetch_fullstack(rec, cursor)
    token, pulse_seen = decode_cursor(cursor)
    if not rec.log_stream:
        return LogsPage(cursor=cursor)
    events: List[dict] = []
    next_token = token
    try:
        kwargs = dict(logGroupName=config.settings().log_group, logStreamName=rec.log_stream,
                      startFromHead=True)
        if token:
            kwargs["nextToken"] = token
        resp = config.client("logs").get_log_events(**kwargs)
        events = resp.get("events", [])
        next_token = resp.get("nextForwardToken", token)
    except Exception as exc:
        if not _not_found(exc):
            raise
        return LogsPage(cursor=cursor)
    lines, phase_message = parse_events(events)
    new_pulse = rec.pulse_lines[pulse_seen:]
    return LogsPage(
        lines=lines + new_pulse,
        cursor=encode_cursor(next_token, len(rec.pulse_lines)),
        new_events=bool(events) or bool(new_pulse),
        phase_message=phase_message,
    )


def tail(rec: StoredRecord, n: int = 400, stream: Optional[str] = None) -> List[str]:
    """Last n visible build lines. The ghost filters boilerplate and keeps its own last 80, so n is generous."""
    stream = stream or rec.log_stream
    if not stream:
        return []
    try:
        resp = config.client("logs").get_log_events(
            logGroupName=config.settings().log_group, logStreamName=stream,
            startFromHead=False, limit=max(200, n * 2))
    except Exception as exc:
        if _not_found(exc):
            return []
        raise
    lines, _ = parse_events(resp.get("events", []))
    return [ln.text for ln in lines][-n:]
