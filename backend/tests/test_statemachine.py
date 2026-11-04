from datetime import datetime, timedelta, timezone

import pytest

from app import builds, expiry, logs, pulse, statemachine
from app.pulse import ProbeResult
from helpers import make_record, pulsing

NOW = datetime(2026, 11, 4, 7, 32, 0, tzinfo=timezone.utc)
API = "https://api.example.net"


@pytest.fixture
def scheduled(monkeypatch):
    calls = []
    monkeypatch.setattr(expiry, "schedule", lambda res: calls.append(res.id))
    return calls


def set_build(monkeypatch, status, stream="stream-1"):
    monkeypatch.setattr(builds, "get", lambda build_id: {"status": status, "log_stream": stream})
    monkeypatch.setattr(logs, "tail", lambda rec, n=80: ["npm ERR! first error", "last line"])


def set_probe(monkeypatch, *results):
    seq = list(results)
    calls = []

    def fake(graves_url, res_id):
        calls.append(res_id)
        return seq.pop(0) if len(seq) > 1 else seq[0]

    monkeypatch.setattr(pulse, "probe", fake)
    return calls


OK = ProbeResult(True, "The page and /r-abc123/a.js both answered 200.", ["GET .. -> 200"])
BAD = ProbeResult(False, "The page answered HTTP 404.", ["GET https://g/r-abc123/ -> 404"])


# ---- build phase -------------------------------------------------------------

def test_summoning_to_building_saves_stream(monkeypatch):
    set_build(monkeypatch, "IN_PROGRESS")
    rec = make_record("summoning")
    assert statemachine.advance(rec, API, NOW) is True
    assert rec.res.status == "building" and rec.log_stream == "stream-1"
    assert rec.res.phase_message == "Cloning the grave"


def test_building_stays_building_no_change(monkeypatch):
    set_build(monkeypatch, "IN_PROGRESS")
    rec = make_record("building")
    rec.log_stream = "stream-1"
    assert statemachine.advance(rec, API, NOW) is False
    assert rec.res.status == "building"


def test_succeeded_starts_pulse(monkeypatch):
    set_build(monkeypatch, "SUCCEEDED")
    rec = make_record("building")
    assert statemachine.advance(rec, API, NOW)
    assert rec.res.status == "checking_pulse"
    assert (rec.res.pulse.attempts, rec.res.pulse.max_attempts) == (0, 20)
    assert rec.pulse_started_at == "2026-11-04T07:32:00Z" and rec.last_probe_at is None


@pytest.mark.parametrize("cb_status", ["FAILED", "FAULT", "TIMED_OUT", "STOPPED"])
def test_failed_build_gets_ghost_from_log_tail(monkeypatch, cb_status):
    set_build(monkeypatch, cb_status)
    rec = make_record("building")
    assert statemachine.advance(rec, API, NOW)
    assert rec.res.status == "failed"
    assert rec.res.ghost.source == "fallback"
    assert rec.res.ghost.raw_tail == ["npm ERR! first error", "last line"]


def test_terminal_states_do_nothing(monkeypatch):
    set_build(monkeypatch, "FAILED")
    for status in ("failed", "cannot_rise", "expired"):
        assert statemachine.advance(make_record(status), API, NOW) is False


# ---- pulse phase -------------------------------------------------------------

def test_pulse_respects_two_second_gap(monkeypatch, scheduled):
    calls = set_probe(monkeypatch, BAD)
    rec = pulsing()
    assert statemachine.advance(rec, API, NOW)  # first probe
    assert len(calls) == 1 and rec.res.pulse.attempts == 1 and rec.res.status == "checking_pulse"
    assert statemachine.advance(rec, API, NOW + timedelta(seconds=1)) is False  # too soon
    assert len(calls) == 1
    assert statemachine.advance(rec, API, NOW + timedelta(seconds=2))
    assert len(calls) == 2 and rec.res.pulse.attempts == 2


def test_pulse_fail_then_pass_goes_alive(monkeypatch, scheduled):
    set_probe(monkeypatch, BAD, OK)
    rec = pulsing()
    statemachine.advance(rec, API, NOW)
    statemachine.advance(rec, API, NOW + timedelta(seconds=2))
    r = rec.res
    assert r.status == "alive" and r.phase_message == "It lives"
    assert r.live_url == "https://graves.example.net/r-abc123/"
    assert r.alive_at == "2026-11-04T07:32:02Z" and r.expires_at == "2026-11-04T07:52:02Z"
    assert r.badge_markdown == ("[![Resurrected](https://api.example.net/badge/r-abc123.svg)]"
                                "(https://ui.example.net/r/r-abc123)")
    assert [ln.kind for ln in rec.pulse_lines] == ["pulse", "pulse"]
    assert scheduled == ["r-abc123"]


def test_pinned_has_no_expiry(monkeypatch, scheduled):
    set_probe(monkeypatch, OK)
    rec = pulsing(pinned=True)
    statemachine.advance(rec, API, NOW)
    assert rec.res.status == "alive" and rec.res.expires_at is None


def test_schedule_failure_does_not_break_alive(monkeypatch):
    set_probe(monkeypatch, OK)

    def boom(res):
        raise RuntimeError("scheduler down")

    monkeypatch.setattr(expiry, "schedule", boom)
    rec = pulsing()
    statemachine.advance(rec, API, NOW)
    assert rec.res.status == "alive"


def test_pulse_deadline_60s_fails_with_probe_ghost(monkeypatch, scheduled):
    set_probe(monkeypatch, BAD)
    rec = pulsing()
    rec.pulse_started_at = "2026-11-04T07:31:00Z"
    rec.res.pulse.attempts = 5
    rec.last_probe_at = "2026-11-04T07:31:50Z"
    assert statemachine.advance(rec, API, datetime(2026, 11, 4, 7, 32, 0, tzinfo=timezone.utc))  # exactly 60 s
    assert rec.res.status == "failed"
    assert rec.res.ghost.raw_tail == BAD.details


def test_pulse_before_deadline_keeps_trying(monkeypatch, scheduled):
    set_probe(monkeypatch, BAD)
    rec = pulsing()
    rec.pulse_started_at = "2026-11-04T07:31:00Z"
    statemachine.advance(rec, API, datetime(2026, 11, 4, 7, 31, 58, tzinfo=timezone.utc))
    assert rec.res.status == "checking_pulse"


def test_pulse_twenty_attempts_fails(monkeypatch, scheduled):
    set_probe(monkeypatch, BAD)
    rec = pulsing()
    rec.pulse_started_at = "2026-11-04T07:31:00Z"
    rec.res.pulse.attempts = 19
    rec.last_probe_at = "2026-11-04T07:31:01Z"
    statemachine.advance(rec, API, datetime(2026, 11, 4, 7, 31, 5, tzinfo=timezone.utc))  # only 5 s in
    assert rec.res.pulse.attempts == 20 and rec.res.status == "failed"


# ---- expiry --------------------------------------------------------------------

def alive(**kw):
    return make_record("alive", live_url="x", alive_at="2026-11-04T07:00:00Z",
                       expires_at="2026-11-04T07:20:00Z", **kw)


def test_alive_past_expiry_becomes_expired():
    rec = alive()
    assert statemachine.advance(rec, API, NOW)  # 07:32 > 07:20
    assert rec.res.status == "expired"


def test_alive_before_expiry_unchanged():
    rec = alive()
    assert statemachine.advance(rec, API, datetime(2026, 11, 4, 7, 19, 59, tzinfo=timezone.utc)) is False
    assert rec.res.status == "alive"


def test_pinned_never_expires():
    rec = alive(pinned=True)
    assert statemachine.advance(rec, API, NOW) is False
    rec = make_record("alive", pinned=True, expires_at=None)
    assert statemachine.advance(rec, API, NOW) is False
