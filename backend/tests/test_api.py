import json

import pytest
from fastapi.testclient import TestClient

from app import autopsy, builds, config, limits, logs, main, service, statemachine, store
from app.autopsy import AutopsyResult
from app.models import RepoRef
from helpers import FakeLogs, make_autopsy, make_record, pulsing

REPO = RepoRef(owner="rahul", name="todo", url="https://github.com/rahul/todo",
               default_branch="main", commit_sha="9f2c1e7")
CONTRACT_KEYS = {"id", "repo", "status", "stack", "deployable", "attempt", "phase_message", "autopsy", "ghost",
                 "live_url", "badge_markdown", "pinned", "pulse", "created_at", "alive_at", "expires_at",
                 "server_time"}


@pytest.fixture
def client(table):
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.fixture
def started(monkeypatch):
    calls = []

    def fake_start(res_id, repo_url, stack, app_dir, commit_sha):
        calls.append(dict(res_id=res_id, repo_url=repo_url, stack=stack, app_dir=app_dir, commit_sha=commit_sha))
        return f"resurrect-build:{len(calls)}"

    monkeypatch.setattr(builds, "start", fake_start)
    return calls


def fake_autopsy(monkeypatch, **kw):
    result = AutopsyResult(autopsy=make_autopsy(**kw), repo=REPO, package_json='{"name":"x"}')
    monkeypatch.setattr(autopsy, "run", lambda parsed: result)


def post(client, url="https://github.com/rahul/todo", **headers):
    return client.post("/resurrections", json={"repo_url": url}, headers=headers)


# ---- POST ----------------------------------------------------------------------

def test_post_starts_build(client, started, monkeypatch):
    fake_autopsy(monkeypatch)
    resp = post(client)
    assert resp.status_code == 201
    body = resp.json()
    assert set(body) == CONTRACT_KEYS
    assert body["status"] == "summoning" and body["phase_message"] == "Summoning" and body["deployable"] is True
    assert body["ghost"] is None and body["pulse"] is None and body["live_url"] is None
    assert body["id"].startswith("r-") and len(body["id"]) == 8
    assert started == [dict(res_id=body["id"], repo_url="https://github.com/rahul/todo", stack="react-vite",
                            app_dir=".", commit_sha="9f2c1e7")]
    stored = store.get(body["id"])
    assert stored.build_id == "resurrect-build:1" and stored.version == 1


def test_post_blocked_starts_no_build(client, started, monkeypatch):
    fake_autopsy(monkeypatch, verdict="blocked", stack="python")
    body = post(client).json()
    assert body["status"] == "cannot_rise" and body["deployable"] is False
    assert started == [] and store.get(body["id"]).build_id is None


def test_post_bad_inputs(client, started):
    r = post(client, "https://example.com/x")
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_url"
    assert r.json()["error"]["retry_after_s"] is None
    assert client.post("/resurrections", json={}).status_code == 400
    assert client.post("/resurrections", content="not json").status_code == 400
    assert client.post("/resurrections", json={"repo_url": 5}).json()["error"]["code"] == "invalid_url"


def test_post_uses_first_forwarded_ip_and_admin_header(client, started, monkeypatch):
    fake_autopsy(monkeypatch)
    seen = []
    monkeypatch.setattr(limits, "check", lambda ip, admin: seen.append((ip, admin)))
    post(client, **{"X-Forwarded-For": "203.0.113.9, 10.0.0.1", "X-Resurrect-Admin": "tok"})
    assert seen == [("203.0.113.9", "tok")]


def test_post_kill_switch(client, started, monkeypatch):
    monkeypatch.setenv("RESURRECTIONS_ENABLED", "false")
    r = post(client)
    assert r.status_code == 503 and r.json()["error"]["code"] == "resurrections_disabled"
    assert client.get("/health").json() == {"ok": True, "resurrections_enabled": False}


def test_limits_error_passes_through(client, started, monkeypatch):
    from app.errors import ApiException

    def deny(ip, admin):
        raise ApiException("rate_limited", "Slow down.", retry_after_s=1800)

    monkeypatch.setattr(limits, "check", deny)
    r = post(client)
    assert r.status_code == 429 and r.json()["error"] == {"code": "rate_limited", "message": "Slow down.",
                                                          "retry_after_s": 1800}


# ---- GET ---------------------------------------------------------------------------

def test_get_unknown_is_404(client):
    r = client.get("/resurrections/r-nope00")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get("/no/such/route").json()["error"]["code"] == "not_found"


def test_get_advances_and_persists(client, monkeypatch):
    store.create(make_record("summoning"))
    monkeypatch.setattr(builds, "get", lambda b: {"status": "IN_PROGRESS", "log_stream": "s1"})
    body = client.get("/resurrections/r-abc123").json()
    assert body["status"] == "building" and set(body) == CONTRACT_KEYS
    stored = store.get("r-abc123")
    assert stored.res.status == "building" and stored.log_stream == "s1" and stored.version == 2


def test_get_version_conflict_returns_newer_record(client, monkeypatch):
    store.create(make_record("summoning"))
    monkeypatch.setattr(builds, "get", lambda b: {"status": "IN_PROGRESS", "log_stream": "s1"})
    real_save = store.save

    def lose_race(rec):
        other = store.get(rec.res.id)  # another poll got there first and moved further along
        other.res.status = "checking_pulse"
        real_save(other)
        real_save(rec)  # stale version -> ConflictError

    monkeypatch.setattr(store, "save", lose_race)
    body = client.get("/resurrections/r-abc123").json()
    assert body["status"] == "checking_pulse"


def test_get_pulse_to_alive_end_to_end(client, monkeypatch):
    store.create(pulsing())
    from app import expiry, pulse
    monkeypatch.setattr(expiry, "schedule", lambda res: None)
    monkeypatch.setattr(pulse, "probe", lambda g, i: pulse.ProbeResult(True, "fine", []))
    body = client.get("/resurrections/r-abc123", headers={"Host": "api.example.net"}).json()
    assert body["status"] == "alive" and body["live_url"] == "https://graves.example.net/r-abc123/"
    assert body["badge_markdown"].startswith("[![Resurrected](https://api.example.net/badge/r-abc123.svg)]")
    assert body["expires_at"] and body["pulse"]["attempts"] == 1


def test_unexpected_error_is_500_internal_without_trace(client, monkeypatch):
    def boom(_):
        raise RuntimeError("secret internals /var/task/app.py")

    monkeypatch.setattr(store, "get", boom)
    r = client.get("/resurrections/r-abc123")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal" and "secret" not in r.text and "Traceback" not in r.text


# ---- logs ------------------------------------------------------------------------------

def use_logs(monkeypatch, fake):
    monkeypatch.setattr(config, "client", lambda name: fake)


def test_logs_before_stream(client):
    store.create(make_record("summoning"))
    assert client.get("/resurrections/r-abc123/logs").json() == {"lines": [], "cursor": None, "done": False}
    assert client.get("/resurrections/r-abc123/logs?cursor=xyz").json()["cursor"] == "xyz"


def test_logs_unknown_id(client):
    assert client.get("/resurrections/r-nope00/logs").status_code == 404


def test_logs_lines_cursor_phase_and_done(client, monkeypatch):
    fake = FakeLogs(["::resurrect:: phase=cloning", 'echo "::resurrect:: phase=cloning"', "Cloning into 'src'...",
                     "::resurrect:: phase=installing", "added 120 packages"])
    use_logs(monkeypatch, fake)
    rec = make_record("building")
    rec.log_stream = "s1"
    store.create(rec)

    first = client.get("/resurrections/r-abc123/logs").json()
    assert [ln["text"] for ln in first["lines"]] == ["Cloning into 'src'...", "added 120 packages"]
    assert "::resurrect::" not in json.dumps(first) and first["done"] is False
    assert store.get("r-abc123").res.phase_message == "Installing dependencies"

    second = client.get(f"/resurrections/r-abc123/logs?cursor={first['cursor']}").json()
    assert second["lines"] == [] and second["cursor"] == first["cursor"] and second["done"] is False

    stored = store.get("r-abc123")
    stored.res.status = "failed"
    store.save(stored)
    last = client.get(f"/resurrections/r-abc123/logs?cursor={first['cursor']}").json()
    assert last["done"] is True
    # A fresh reader of a finished build still gets the lines first, then done on the next call
    again = client.get("/resurrections/r-abc123/logs").json()
    assert len(again["lines"]) == 2 and again["done"] is False


def test_logs_phase_write_losing_race_still_returns_lines(client, monkeypatch, table):
    use_logs(monkeypatch, FakeLogs(["::resurrect:: phase=building", "vite v5 building for production..."]))
    rec = make_record("building")
    rec.log_stream = "s1"
    store.create(rec)
    table.fail_next_save = True  # the phase_message write will hit a version conflict
    r = client.get("/resurrections/r-abc123/logs")
    assert r.status_code == 200
    assert [ln["text"] for ln in r.json()["lines"]] == ["vite v5 building for production..."]
    assert store.get("r-abc123").res.phase_message == "Summoning"  # skipped, not written


def test_logs_do_not_touch_phase_after_alive(client, monkeypatch):
    use_logs(monkeypatch, FakeLogs(["::resurrect:: phase=uploading"]))
    rec = make_record("alive", phase_message="It lives", expires_at="2099-01-01T00:00:00Z")
    rec.log_stream = "s1"
    store.create(rec)
    client.get("/resurrections/r-abc123/logs")
    assert store.get("r-abc123").res.phase_message == "It lives"


# ---- retry -----------------------------------------------------------------------------

def test_retry_only_from_failed(client, started, monkeypatch):
    fake_autopsy(monkeypatch)
    store.create(make_record("alive", expires_at="2099-01-01T00:00:00Z"))
    r = client.post("/resurrections/r-abc123/retry")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_retryable"
    assert client.post("/resurrections/r-nope00/retry").status_code == 404
    assert started == []


def test_retry_failed_restarts_build(client, started, monkeypatch):
    fake_autopsy(monkeypatch)
    from app.models import Ghost, LogLine
    rec = make_record("failed", phase_message="The séance failed")
    rec.res.ghost = Ghost(cause="c", fix="f", confidence="low", source="fallback", raw_tail=[])
    rec.log_stream = "old"
    rec.pulse_lines = [LogLine(ts="2026-11-04T07:32:00Z", text="x", kind="pulse")]
    store.create(rec)
    r = client.post("/resurrections/r-abc123/retry")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "summoning" and body["attempt"] == 2 and body["ghost"] is None and body["pulse"] is None
    assert started[0]["res_id"] == "r-abc123"
    stored = store.get("r-abc123")
    assert stored.build_id == "resurrect-build:1" and stored.log_stream is None and stored.pulse_lines == []


def test_retry_that_now_blocks(client, started, monkeypatch):
    fake_autopsy(monkeypatch, verdict="blocked", stack="python")
    store.create(make_record("failed"))
    body = client.post("/resurrections/r-abc123/retry").json()
    assert body["status"] == "cannot_rise" and started == []


# ---- misc -----------------------------------------------------------------------------

def test_health_and_badge(client):
    assert client.get("/health").json() == {"ok": True, "resurrections_enabled": True}
    missing = client.get("/badge/r-nope00.svg")
    assert missing.status_code == 404 and "unknown" in missing.text
    assert missing.headers["cache-control"] == "no-cache" and missing.headers["content-type"].startswith("image/svg+xml")
    store.create(make_record("alive", expires_at="2099-01-01T00:00:00Z"))
    ok = client.get("/badge/r-abc123.svg")
    assert ok.status_code == 200 and "alive" in ok.text


def test_api_url_from_host_and_proto():
    class Req:
        headers = {"host": "abc.lambda-url.us-east-1.on.aws", "x-forwarded-proto": "https"}
        scope = {}

    assert main.api_url(Req()) == "https://abc.lambda-url.us-east-1.on.aws"

    class Req2:
        headers = {}
        scope = {"aws.event": {"requestContext": {"domainName": "d.example.com", "http": {"sourceIp": "1.2.3.4"}}}}

    assert main.api_url(Req2()) == "https://d.example.com"
    assert main.client_ip(Req2()) == "1.2.3.4"
