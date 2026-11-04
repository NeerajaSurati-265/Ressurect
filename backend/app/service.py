"""Create and retry resurrections (the POST flows)."""
from __future__ import annotations

import secrets
from typing import Optional

from . import autopsy as autopsy_mod
from . import builds, config, github, limits, store
from .errors import ApiException
from .models import Resurrection, StoredRecord
from .timeutil import iso, now_utc

ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def new_id() -> str:
    return "r-" + "".join(secrets.choice(ID_ALPHABET) for _ in range(6))


def _require_enabled() -> None:
    if not config.settings().resurrections_enabled:
        raise ApiException("resurrections_disabled",
                           "Resurrections are paused for now. Please try again later.")


def _apply_autopsy(rec: StoredRecord, result: autopsy_mod.AutopsyResult,
                   admin_header: Optional[str] = None) -> None:
    """Copy the autopsy outcome into the record and start a build unless it is blocked."""
    r = rec.res
    r.repo = result.repo
    r.autopsy = result.autopsy
    r.stack = result.autopsy.stack
    r.deployable = autopsy_mod.is_deployable(result.autopsy)
    rec.package_json = result.package_json
    if not r.deployable:
        r.status = "cannot_rise"
        r.phase_message = "Cannot rise yet"
        rec.build_id = None
        return
    limits.reserve_build(admin_header)  # counts only builds that really start
    rec.build_id = builds.start(r.id, r.repo.url, r.stack, r.autopsy.app_dir, r.repo.commit_sha)
    r.status = "summoning"
    r.phase_message = "Summoning"


def create(repo_url: str, ip: Optional[str], admin_header: Optional[str]) -> StoredRecord:
    _require_enabled()
    parsed = github.parse_repo_url(repo_url)
    limits.check(ip, admin_header)
    result = autopsy_mod.run(parsed)

    res_id = new_id()
    while store.get(res_id) is not None:
        res_id = new_id()
    now = iso(now_utc())
    res = Resurrection(
        id=res_id, repo=result.repo, status="summoning", stack=result.autopsy.stack, deployable=False,
        attempt=1, phase_message="Summoning", autopsy=result.autopsy, created_at=now, server_time=now)
    rec = StoredRecord(res=res, client_ip=ip)
    _apply_autopsy(rec, result, admin_header)
    store.create(rec)
    return rec


def retry(rec_id: str, ip: Optional[str], admin_header: Optional[str]) -> StoredRecord:
    rec = store.get(rec_id)
    if rec is None:
        raise ApiException("not_found", "We can't find that resurrection.")
    if rec.res.status != "failed":
        raise ApiException("not_retryable", "Only a failed resurrection can be retried.")
    _require_enabled()
    limits.check(ip, admin_header)

    result = autopsy_mod.run(github.parse_repo_url(rec.res.repo.url))
    r = rec.res
    r.attempt += 1
    r.ghost = None
    r.pulse = None
    r.live_url = None
    r.badge_markdown = None
    r.alive_at = None
    r.expires_at = None
    rec.pulse_lines = []
    rec.pulse_started_at = None
    rec.last_probe_at = None
    rec.log_stream = None
    _apply_autopsy(rec, result, admin_header)
    try:
        store.save(rec)
    except store.ConflictError:
        raise ApiException("not_retryable", "That resurrection changed while retrying. Refresh and try again.")
    return rec
