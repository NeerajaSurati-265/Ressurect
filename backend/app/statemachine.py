"""The poll-driven state machine. Each GET /resurrections/{id} calls advance() once."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from . import builds, config, expiry, ghost, logs, pulse
from .models import LogLine, Pulse, StoredRecord
from .timeutil import iso, now_utc, parse_iso

logger = logging.getLogger(__name__)

PROBE_INTERVAL_S = 2
PULSE_DEADLINE_S = 60
MAX_ATTEMPTS = 20
FAILED_BUILD = {"FAILED", "FAULT", "TIMED_OUT", "STOPPED"}


def advance(rec: StoredRecord, api_url: str = "", now: Optional[datetime] = None) -> bool:
    """Move the record forward if the world changed. Returns True if the record needs saving."""
    now = now or now_utc()
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


def _advance_pulse(rec: StoredRecord, api_url: str, now: datetime) -> bool:
    r = rec.res
    if rec.last_probe_at and (now - parse_iso(rec.last_probe_at)).total_seconds() < PROBE_INTERVAL_S:
        return False
    started = parse_iso(rec.pulse_started_at) if rec.pulse_started_at else now
    result = pulse.probe(config.settings().graves_url, r.id)
    pulse_state = r.pulse or Pulse(attempts=0, max_attempts=MAX_ATTEMPTS)
    pulse_state.attempts += 1
    r.pulse = pulse_state
    rec.last_probe_at = iso(now)
    rec.pulse_lines.append(LogLine(
        ts=iso(now), kind="pulse",
        text=f"Pulse check {pulse_state.attempts}/{pulse_state.max_attempts}: {result.summary}"))

    if result.ok:
        _mark_alive(rec, api_url, now)
    elif (now - started).total_seconds() >= PULSE_DEADLINE_S or pulse_state.attempts >= pulse_state.max_attempts:
        r.status = "failed"
        r.phase_message = "No pulse"
        r.ghost = ghost.explain(r.stack, r.autopsy.findings, rec.package_json, [], probe_results=result.details)
    return True


def _mark_alive(rec: StoredRecord, api_url: str, now: datetime) -> None:
    s = config.settings()
    r = rec.res
    r.status = "alive"
    r.phase_message = "It lives"
    r.live_url = f"{s.graves_url}/{r.id}/"
    r.alive_at = iso(now)
    r.expires_at = None if r.pinned else iso(now + timedelta(minutes=s.lifetime_minutes))
    r.badge_markdown = f"[![Resurrected]({api_url}/badge/{r.id}.svg)]({s.ui_url}/r/{r.id})"
    try:
        expiry.schedule(r)
    except Exception:
        # GET past expires_at reports "expired" anyway, so a missing schedule is not fatal.
        logger.exception("could not schedule the reaper for %s", r.id)
