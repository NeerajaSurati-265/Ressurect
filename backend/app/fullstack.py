"""B5: the state machine for a full-stack record (React frontend + backend from one repo).

Status only ever moves forward: summoning -> building -> checking_pulse -> alive (or failed).
Stages (StoredRecord.fs_stage), all inside those statuses:
  backend        backend image build, then the rz-<id> function            (status building)
  backend_pulse  backend answers HTTP                                      (status building)
  frontend       frontend build with the backend URL wired in              (status building)
  frontend_pulse frontend on graves answers, then the wiring check         (status checking_pulse)
Any failure cleans the backend up at once and names the half that broke in the ghost.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

from . import builds, config, functions, ghost, limits, logs, pulse
from .models import LogLine, Pulse, StoredRecord
from .timeutil import iso, now_utc, parse_iso

logger = logging.getLogger(__name__)

PROBE_INTERVAL_S = 2
BACKEND_PULSE_DEADLINE_S = 45
FRONTEND_PULSE_DEADLINE_S = 60
FUNCTION_PENDING_LIMIT_S = 180
MAX_ATTEMPTS = 20
FAILED_BUILD = {"FAILED", "FAULT", "TIMED_OUT", "STOPPED"}
WIRED_KINDS = ("env", "localhost")

API_HALF = "The API failed to start. "
FRONTEND_HALF = "The frontend build failed. "


def cors_origin() -> Optional[str]:
    """The graves origin (scheme + host, no path): the only site allowed to call the API from a browser."""
    u = urlparse(config.settings().graves_url)
    return "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else None


def advance(rec: StoredRecord, api_url: str, now: Optional[datetime] = None) -> bool:
    from . import statemachine

    now = now or now_utc()
    status = rec.res.status
    if status == "alive":
        return statemachine._expire_if_due(rec, now)
    if status not in ("summoning", "building", "checking_pulse"):
        return False
    stage = rec.fs_stage or "backend"
    if stage == "backend":
        return _backend(rec, now)
    if stage == "backend_pulse":
        return _backend_pulse(rec, now)
    if stage == "frontend":
        return _frontend(rec, now)
    return _frontend_pulse(rec, api_url, now)


# ------------------------------------------------------------------ failure

def release_unused_slot(rec: StoredRecord) -> None:
    """The frontend build never started: give its reserved daily-quota slot back."""
    if rec.quota_slot_pk:
        limits.release_build(rec.quota_slot_pk, 1)
        rec.quota_slot_pk = None


def _fail(rec: StoredRecord, half: str, phase: str, evidence: List[str],
          build_lines: Optional[List[str]] = None) -> None:
    """Failed record: a ghost that names the half, then take the backend down and free what was reserved."""
    r = rec.res
    if build_lines is not None:
        g = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, build_lines)
    else:
        g = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, [], probe_results=evidence)
    r.ghost = g.model_copy(update={"cause": half + g.cause})
    r.status = "failed"
    r.phase_message = phase
    release_unused_slot(rec)
    functions.cleanup(r.id)  # the ghost already holds the logs


def _fail_backend(rec: StoredRecord, phase: str, details: List[str], app_lines: Optional[List[str]] = None) -> None:
    if app_lines is None:
        app_lines = functions.app_logs(rec.res.id)
    _fail(rec, API_HALF, phase, list(details) + (["--- app logs ---"] + app_lines if app_lines else []))


def _fail_frontend(rec: StoredRecord, phase: str, details: List[str],
                   build_lines: Optional[List[str]] = None) -> None:
    _fail(rec, FRONTEND_HALF, phase, details, build_lines)


# ------------------------------------------------------------------ stage: backend

def _backend(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    if rec.function_created_at:
        return _function_wait(rec, now)
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
            r.phase_message = "Raising the server"
            changed = True
    elif status == "SUCCEEDED":
        r.status = "building"
        r.phase_message = "Raising the server"
        try:
            rec.function_url = functions.create(r.id, rec.backend, cors_origin=cors_origin())
        except Exception as exc:
            logger.exception("could not create the function for %s", r.id)
            code = (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", type(exc).__name__)
            _fail_backend(rec, "The server would not rise", ["Could not create the app's Lambda function: %s" % code])
            return True
        rec.function_created_at = iso(now)
        changed = True
    elif status in FAILED_BUILD:
        _fail(rec, API_HALF, "The séance failed", [], build_lines=logs.tail(rec))
        changed = True
    return changed


def _function_wait(rec: StoredRecord, now: datetime) -> bool:
    st = functions.state(rec.res.id)
    if st["state"] == "Active":
        rec.fs_stage = "backend_pulse"
        rec.pulse_started_at = iso(now)
        rec.last_probe_at = None
        return True
    if st["state"] in ("Failed", "missing"):
        detail = "Lambda function state: %s%s%s" % (
            st["state"], " (%s)" % st["code"] if st["code"] else "", ": %s" % st["reason"] if st["reason"] else "")
        _fail_backend(rec, "The server would not rise", [detail])
        return True
    if (now - parse_iso(rec.function_created_at)).total_seconds() >= FUNCTION_PENDING_LIMIT_S:
        _fail_backend(rec, "The server would not rise",
                      ["Lambda function still %s after %d seconds" % (st["state"], FUNCTION_PENDING_LIMIT_S)])
        return True
    return False


# ------------------------------------------------------------------ stage: backend_pulse

def _backend_pulse(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    if rec.last_probe_at and (now - parse_iso(rec.last_probe_at)).total_seconds() < PROBE_INTERVAL_S:
        return False
    started = parse_iso(rec.pulse_started_at) if rec.pulse_started_at else now
    result = pulse.probe_backend(rec.function_url or "", rec.backend.probe_paths)
    n = 1 + sum(1 for ln in rec.pulse_lines if ln.text.startswith("API pulse check"))
    rec.last_probe_at = iso(now)
    rec.pulse_lines.append(LogLine(ts=iso(now), kind="pulse", text="API pulse check %d: %s" % (n, result.summary)))

    if result.ok:
        _start_frontend(rec, now)
        return True
    app_lines = functions.app_logs(r.id)
    crash = functions.crash_line(app_lines)  # a crashed app never recovers: fail now
    if crash:
        _fail_backend(rec, "The server crashed", list(result.details) + ["App crashed on startup: " + crash[:300]],
                      app_lines)
        return True
    if (now - started).total_seconds() >= BACKEND_PULSE_DEADLINE_S or n >= MAX_ATTEMPTS:
        _fail_backend(rec, "No pulse", result.details, app_lines)
    return True


def _start_frontend(rec: StoredRecord, now: datetime) -> None:
    r, fs = rec.res, rec.fullstack
    url = (rec.function_url or "").rstrip("/")
    rec.pulse_lines.append(LogLine(ts=iso(now), kind="system",
                                   text="The server lives at %s. Now building the frontend." % url))
    rec.fe_pulse_offset = len(rec.pulse_lines)  # everything after this belongs to the frontend half
    r.phase_message = "Building the frontend"
    env_names = fs.env_names if fs.wiring_kind == "env" else []
    origins = fs.localhost_urls if fs.wiring_kind == "localhost" else []
    try:
        rec.fe_build_id = builds.start_frontend(r.id, r.repo.url, fs.frontend_stack, fs.frontend_dir,
                                                r.repo.commit_sha, url, env_names, origins)
    except Exception as exc:
        logger.exception("could not start the frontend build for %s", r.id)
        code = (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", type(exc).__name__)
        _fail_frontend(rec, "The frontend build would not start", ["Could not start the frontend build: %s" % code])
        return
    rec.quota_slot_pk = None  # the reserved slot is now a real build
    rec.fs_stage = "frontend"


# ------------------------------------------------------------------ stage: frontend

def _frontend(rec: StoredRecord, now: datetime) -> bool:
    r = rec.res
    if not rec.fe_build_id:
        return False
    info = builds.get(rec.fe_build_id)
    changed = False
    if info["log_stream"] and rec.fe_log_stream != info["log_stream"]:
        rec.fe_log_stream = info["log_stream"]
        changed = True
    status = info["status"]
    if status == "SUCCEEDED":
        r.status = "checking_pulse"
        r.phase_message = "Checking for a pulse"
        r.pulse = Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
        rec.fs_stage = "frontend_pulse"
        rec.pulse_started_at = iso(now)
        rec.last_probe_at = None
        return True
    if status in FAILED_BUILD:
        _fail_frontend(rec, "The séance failed", [], build_lines=logs.tail(rec, stream=rec.fe_log_stream))
        return True
    return changed


# ------------------------------------------------------------------ stage: frontend_pulse

def _frontend_pulse(rec: StoredRecord, api_url: str, now: datetime) -> bool:
    from . import statemachine

    r, fs = rec.res, rec.fullstack
    if rec.last_probe_at and (now - parse_iso(rec.last_probe_at)).total_seconds() < PROBE_INTERVAL_S:
        return False
    started = parse_iso(rec.pulse_started_at) if rec.pulse_started_at else now
    result = pulse.probe(config.settings().graves_url, r.id)
    state = r.pulse or Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
    state.attempts += 1
    r.pulse = state
    rec.last_probe_at = iso(now)
    rec.pulse_lines.append(LogLine(
        ts=iso(now), kind="pulse", text="Pulse check %d/%d: %s" % (state.attempts, state.max_attempts, result.summary)))

    if result.ok and fs.wiring_kind in WIRED_KINDS:
        wiring = pulse.check_wiring(config.settings().graves_url, r.id, rec.function_url or "")
        rec.pulse_lines.append(LogLine(ts=iso(now), kind="pulse", text="Wiring check: %s" % wiring.summary))
        if wiring.ok:
            statemachine._mark_alive(rec, api_url, now)
            return True
        if not wiring.transient:
            _fail_frontend(rec, "The frontend is not wired to the API",
                           ["Wiring check: %s" % wiring.summary, _unwired(fs)] + wiring.details)
            return True
        result = wiring  # could not look: try again until the deadline
    elif result.ok:
        statemachine._mark_alive(rec, api_url, now)
        return True

    if (now - started).total_seconds() >= FRONTEND_PULSE_DEADLINE_S or state.attempts >= state.max_attempts:
        _fail_frontend(rec, "No pulse", result.details)
    return True


def _unwired(fs) -> str:
    if fs.wiring_kind == "env":
        return ("The frontend reads %s, but the live JavaScript does not contain the API address, so %s did not "
                "get wired." % (", ".join(fs.env_names), ", ".join(fs.env_names)))
    return ("The frontend calls %s, but the live JavaScript does not contain the API address, so that URL did not "
            "get wired." % ", ".join(fs.localhost_urls))
