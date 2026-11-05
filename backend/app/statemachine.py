"""The poll-driven state machine. Each GET /resurrections/{id} calls advance() once."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from . import builds, config, expiry, functions, ghost, logs, pulse
from .models import LogLine, Pulse, StoredRecord
from .timeutil import iso, now_utc, parse_iso

logger = logging.getLogger(__name__)

PROBE_INTERVAL_S = 2
PULSE_DEADLINE_S = 60
MAX_ATTEMPTS = 20
FAILED_BUILD = {"FAILED", "FAULT", "TIMED_OUT", "STOPPED"}
BACKEND_PULSE_DEADLINE_S = 45     # no answer for this long means it is not coming (a crash is caught sooner)
FUNCTION_PENDING_LIMIT_S = 180    # a function stuck in Pending this long has failed


def advance(rec: StoredRecord, api_url: str = "", now: Optional[datetime] = None) -> bool:
    """Move the record forward if the world changed. Returns True if the record needs saving."""
    now = now or now_utc()
    if rec.fullstack is not None:  # B5: a React frontend plus a backend, one record
        from . import fullstack
        return fullstack.advance(rec, api_url, now)
    status = rec.res.status
    if status == "alive":
        return _expire_if_due(rec, now)
    if status in ("summoning", "building"):
        return _advance_build(rec, now)
    if status == "checking_pulse":
        return _advance_pulse(rec, api_url, now)
    return False


def _expire_if_due(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    if r.pinned or not r.expires_at or parse_iso(r.expires_at) > now:
        return False
    r.status = "expired"
    r.phase_message = "Returned to the grave"
    return True


def _advance_build(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    if rec.backend is not None and rec.function_created_at:
        return _advance_function(rec, now)  # the image is built; we are waiting for the function
    if not rec.build_id:
        return False
    info = builds.get(rec.build_id)
    changed = False
    if info["log_stream"] and rec.log_stream != info["log_stream"]:
        rec.log_stream = info["log_stream"]
        changed = True
    status = info["status"]
    if status == "IN_PROGRESS":
        if r.status == "summoning":
            r.status = "building"
            r.phase_message = "Cloning the grave"
            changed = True
    elif status == "SUCCEEDED" and rec.backend is not None:
        _raise_server(rec, now)
        changed = True
    elif status == "SUCCEEDED":
        r.status = "checking_pulse"
        r.phase_message = "Checking for a pulse"
        r.pulse = Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
        rec.pulse_started_at = iso(now)
        rec.last_probe_at = None
        changed = True
    elif status in FAILED_BUILD:
        r.status = "failed"
        r.phase_message = "The séance failed"
        r.ghost = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, logs.tail(rec))
        changed = True
    return changed


def _fail_backend(rec: StoredRecord, phase: str, details: list, app_lines: Optional[list] = None) -> None:
    """Failed backend: ghost from what we know plus the app's own logs, then free its live slot."""
    r = rec.res
    if app_lines is None:
        app_lines = functions.app_logs(r.id)
    evidence = list(details) + (["--- app logs ---"] + app_lines if app_lines else [])
    r.status = "failed"
    r.phase_message = phase
    r.ghost = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, [], probe_results=evidence)
    functions.cleanup(r.id)  # the ghost already holds the logs


def _raise_server(rec: StoredRecord, now: datetime) -> None:
    """Build succeeded: create the rz-<id> function. Idempotent; stays in `building` meanwhile."""
    r = rec.res
    r.phase_message = "Raising the server"
    try:
        rec.function_url = functions.create(r.id, rec.backend)
    except Exception as exc:
        logger.exception("could not create the function for %s", r.id)
        code = (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", type(exc).__name__)
        _fail_backend(rec, "The server would not rise", ["Could not create the app's Lambda function: %s" % code])
        return
    rec.function_created_at = iso(now)


def _advance_function(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    st = functions.state(r.id)
    if st["state"] == "Active":
        r.status = "checking_pulse"
        r.phase_message = "Checking for a pulse"
        r.pulse = Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
        rec.pulse_started_at = iso(now)
        rec.last_probe_at = None
        return True
    if st["state"] in ("Failed", "missing"):
        detail = "Lambda function state: %s%s%s" % (
            st["state"], " (%s)" % st["code"] if st["code"] else "", ": %s" % st["reason"] if st["reason"] else "")
        _fail_backend(rec, "The server would not rise", [detail])
        return True
    age = (now - parse_iso(rec.function_created_at)).total_seconds()
    if age >= FUNCTION_PENDING_LIMIT_S:
        _fail_backend(rec, "The server would not rise",
                      ["Lambda function still %s after %d seconds" % (st["state"], FUNCTION_PENDING_LIMIT_S)])
        return True
    return False


def _advance_pulse(rec: StoredRecord, api_url: str, now: datetime) -> bool:
    r = rec.res
    if rec.last_probe_at and (now - parse_iso(rec.last_probe_at)).total_seconds() < PROBE_INTERVAL_S:
        return False
    started = parse_iso(rec.pulse_started_at) if rec.pulse_started_at else now
    if rec.backend is not None:
        result = pulse.probe_backend(rec.function_url or "", rec.backend.probe_paths)
        deadline = BACKEND_PULSE_DEADLINE_S
    else:
        result = pulse.probe(config.settings().graves_url, r.id)
        deadline = PULSE_DEADLINE_S
    pulse_state = r.pulse or Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
    pulse_state.attempts += 1
    r.pulse = pulse_state
    rec.last_probe_at = iso(now)
    rec.pulse_lines.append(LogLine(
        ts=iso(now), kind="pulse",
        text=f"Pulse check {pulse_state.attempts}/{pulse_state.max_attempts}: {result.summary}"))

    if result.ok:
        _mark_alive(rec, api_url, now)
        return True

    app_lines = None
    if rec.backend is not None:
        # A crashed app never recovers, so do not wait out the deadline: read its logs and fail now.
        app_lines = functions.app_logs(r.id)
        crash = functions.crash_line(app_lines)
        if crash:
            _fail_backend(rec, "The server crashed", list(result.details) + ["App crashed on startup: " + crash[:300]],
                          app_lines)
            return True

    if (now - started).total_seconds() >= deadline or pulse_state.attempts >= pulse_state.max_attempts:
        if rec.backend is not None:
            _fail_backend(rec, "No pulse", result.details, app_lines)
        else:
            r.status = "failed"
            r.phase_message = "No pulse"
            r.ghost = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, [],
                                    probe_results=result.details)
    return True


def _mark_alive(rec: StoredRecord, api_url: str, now: datetime) -> None:
    s = config.settings()
    r = rec.res
    r.status = "alive"
    r.phase_message = "It lives"
    if rec.backend is not None and rec.function_url and rec.fullstack is None:
        r.live_url = rec.function_url.rstrip("/") + (rec.backend.live_path or "/")
    else:
        r.live_url = f"{s.graves_url}/{r.id}/"
    r.alive_at = iso(now)
    r.expires_at = None if r.pinned else iso(now + timedelta(minutes=s.lifetime_minutes))
    r.badge_markdown = f"[![Resurrected]({api_url}/badge/{r.id}.svg)]({s.ui_url}/r/{r.id})"
    try:
        expiry.schedule(r)
    except Exception:
        # GET past expires_at reports "expired" anyway, so a missing schedule is not fatal.
        logger.exception("could not schedule the reaper for %s", r.id)
