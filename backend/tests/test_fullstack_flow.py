"""B5 Phase 3: the full-stack state machine, pulse, logs, cleanup, guardrails. All AWS is faked."""
import base64
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from app import (autopsy, bedrock, builds, config, expiry, functions, github, limits, logs, pulse, reaper,
                 service, statemachine, store)
from app.errors import ApiException
from app.models import BackendInfo, FullstackInfo, LogLine, RepoRef
from tests.helpers import make_autopsy, make_record
from tests.test_backends import CF, INFO, URL, Err, FakeEcr, FakeLambda, FakeLogs, NoS3
from tests.test_expiry_reaper import FakeS3

NOW = datetime(2026, 11, 4, 9, 0, 0, tzinfo=timezone.utc)
GRAVES = "https://d111.cloudfront.net"
FN = URL.rstrip("/")


def fs_info(kind="env", **kw):
    base = dict(frontend_dir="frontend", backend_dir="backend", frontend_stack="react-vite", backend=INFO,
                wiring_kind=kind, env_names=["VITE_API_URL"] if kind == "env" else [],
                localhost_urls=["http://localhost:8000"] if kind == "localhost" else [])
    base.update(kw)
    return FullstackInfo(**base)


def fs_rec(stage="backend", status="building", kind="env", **kw):
    rec = make_record(status, **kw)
    rec.res.autopsy = make_autopsy(app_dir="frontend")
    rec.backend, rec.fullstack, rec.fs_stage = INFO, fs_info(kind), stage
    rec.build_id = "apps:1"
    return rec


class Builds:
    """Scripted CodeBuild: status per build id."""

    def __init__(self, monkeypatch):
        self.status = {"apps:1": "IN_PROGRESS", "web:1": "IN_PROGRESS"}
        self.frontend_calls, self.fail_start = [], None
        monkeypatch.setattr(builds, "get", lambda b: {"status": self.status[b], "log_stream": "s-" + b})

        def start_frontend(*a, **k):
            if self.fail_start:
                raise self.fail_start
            self.frontend_calls.append(a)
            return "web:1"
        monkeypatch.setattr(builds, "start_frontend", start_frontend)


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("ECR_APPS_URI", "123.dkr.ecr.us-east-1.amazonaws.com/resurrect-apps")
    monkeypatch.setenv("APP_EXEC_ROLE_ARN", "arn:aws:iam::123:role/resurrect-app-exec")
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    monkeypatch.setenv("FULLSTACK_ENABLED", "true")
    monkeypatch.setenv("GRAVES_URL", GRAVES + "/")
    fake = type("AWS", (), {})()
    fake.lam, fake.logs, fake.ecr = FakeLambda(), FakeLogs(), FakeEcr(["r-abc123"])
    fake.logs.groups.add("/aws/lambda/rz-r-abc123")
    fake.lam.functions["rz-r-abc123"] = {}
    fake.scheduled = []
    monkeypatch.setattr(config, "client", lambda n: {"lambda": fake.lam, "logs": fake.logs, "ecr": fake.ecr}[n])
    monkeypatch.setattr(expiry, "schedule", lambda res: fake.scheduled.append(res.id))
    fake.released = []
    monkeypatch.setattr(limits, "release_build", lambda pk, n=1: fake.released.append((pk, n)))
    fake.builds = Builds(monkeypatch)
    monkeypatch.setattr(bedrock, "converse_json", lambda *a, **k: None)
    return fake


def step(rec, seconds):
    return statemachine.advance(rec, "https://api", NOW + timedelta(seconds=seconds))


def gone(aws):
    return ("rz-r-abc123" not in aws.lam.functions and "r-abc123" not in aws.ecr.tags
            and "/aws/lambda/rz-r-abc123" not in aws.logs.groups)


PAGE = '<html><script type="module" src="/r-abc123/assets/index-1.js"></script></html>'


def site(js_text="console.log(1)"):
    respx.get(GRAVES + "/r-abc123/").respond(200, text=PAGE)
    respx.get(GRAVES + "/r-abc123/assets/index-1.js").respond(200, text=js_text)


# ---- the whole story ------------------------------------------------------------------------------

@respx.mock
def test_happy_path_every_transition(aws):
    rec = fs_rec("backend", "summoning")
    # backend build runs
    assert step(rec, 1) is True and (rec.res.status, rec.res.phase_message) == ("building", "Raising the server")
    assert rec.log_stream == "s-apps:1"
    aws.builds.status["apps:1"] = "SUCCEEDED"
    assert step(rec, 2) is True
    assert rec.function_url == URL and rec.res.status == "building" and rec.fs_stage == "backend"
    cors = dict(aws.lam.calls)["create_function_url_config"]["Cors"]
    assert cors["AllowOrigins"] == [GRAVES] and cors["AllowMethods"] == ["*"] and cors["AllowHeaders"] == ["*"]
    assert step(rec, 3) is False                                  # Pending: nothing new, no second create
    assert sum(1 for c in aws.lam.calls if c[0] == "create_function") == 1
    aws.lam.fn_state = "Active"
    assert step(rec, 4) is True and rec.fs_stage == "backend_pulse" and rec.res.status == "building"
    # backend pulse (still `building`: the status never goes backwards)
    respx.get(URL + "health").respond(200)
    assert step(rec, 6) is True
    assert rec.fs_stage == "frontend" and rec.res.status == "building"
    assert rec.res.phase_message == "Building the frontend"
    texts = [(ln.kind, ln.text) for ln in rec.pulse_lines]
    assert texts[0][0] == "pulse" and texts[0][1].startswith("API pulse check 1")
    assert texts[1] == ("system", "The server lives at %s. Now building the frontend." % FN)
    assert rec.fe_pulse_offset == 2
    (call,) = aws.builds.frontend_calls
    assert call[:5] == ("r-abc123", "https://github.com/rahul/todo", "react-vite", "frontend", "9f2c1e7")
    assert call[5:] == (FN, ["VITE_API_URL"], [])
    # frontend build
    step(rec, 7)                                                  # still running (only the log stream is learned)
    assert rec.res.status == "building" and rec.fs_stage == "frontend" and rec.fe_log_stream == "s-web:1"
    aws.builds.status["web:1"] = "SUCCEEDED"
    assert step(rec, 8) is True
    assert (rec.res.status, rec.fs_stage, rec.fe_log_stream) == ("checking_pulse", "frontend_pulse", "s-web:1")
    assert rec.res.pulse.attempts == 0
    # frontend pulse + wiring check
    site("fetch('%s/notes')" % FN)
    assert step(rec, 10) is True
    r = rec.res
    assert r.status == "alive" and r.phase_message == "It lives"
    assert r.live_url == GRAVES + "/r-abc123/"                    # the frontend, never the function URL
    assert r.expires_at == "2026-11-04T09:20:10Z" and aws.scheduled == ["r-abc123"]
    assert [ln.text for ln in rec.pulse_lines][-1].startswith("Wiring check: ")
    assert rec.res.ghost is None and aws.released == []
    assert not gone(aws)                                          # the API stays up while the site lives


@respx.mock
def test_localhost_kind_sends_origins_not_env_names(aws):
    rec = fs_rec("backend_pulse", kind="localhost")
    rec.function_url, rec.pulse_started_at = URL, "2026-11-04T09:00:00Z"
    respx.get(URL + "health").respond(200)
    step(rec, 1)
    assert aws.builds.frontend_calls[0][5:] == (FN, [], ["http://localhost:8000"])


@respx.mock
@pytest.mark.parametrize("kind", ["proxy", "none", "unsupported"])
def test_unwired_kinds_pass_without_a_wiring_check(aws, kind):
    rec = fs_rec("frontend_pulse", "checking_pulse", kind=kind)
    rec.function_url = URL
    site("no backend url in here")
    assert step(rec, 1) is True and rec.res.status == "alive"
    assert aws.builds.frontend_calls == []


# ---- wiring check ---------------------------------------------------------------------------------

@respx.mock
def test_wiring_missing_fails_and_names_the_env_name_and_cleans_up(aws):
    rec = fs_rec("frontend_pulse", "checking_pulse")
    rec.function_url = URL
    site("fetch('/api/notes')")
    step(rec, 1)
    r = rec.res
    assert r.status == "failed" and r.phase_message == "The frontend is not wired to the API"
    assert r.ghost.cause.startswith("The frontend build failed.")
    assert any("VITE_API_URL" in ln for ln in r.ghost.raw_tail)
    assert gone(aws)


@respx.mock
def test_wiring_missing_for_localhost_names_the_url(aws):
    rec = fs_rec("frontend_pulse", "checking_pulse", kind="localhost")
    rec.function_url = URL
    site("fetch('http://localhost:8000/notes')")
    step(rec, 1)
    assert rec.res.status == "failed" and any("http://localhost:8000" in ln for ln in rec.res.ghost.raw_tail)


@respx.mock
def test_wiring_check_that_cannot_look_keeps_polling_until_the_deadline(aws):
    rec = fs_rec("frontend_pulse", "checking_pulse")
    rec.function_url, rec.pulse_started_at = URL, "2026-11-04T09:00:00Z"
    respx.get(GRAVES + "/r-abc123/").respond(200, text=PAGE)
    respx.get(GRAVES + "/r-abc123/assets/index-1.js").respond(503)
    step(rec, 3)
    assert rec.res.status == "checking_pulse"
    step(rec, 70)
    assert rec.res.status == "failed" and rec.res.phase_message == "No pulse" and gone(aws)


@respx.mock
def test_check_wiring_looks_in_more_than_the_first_chunk():
    html = ('<html><script type="module" src="/r-abc123/assets/index.js"></script>'
            '<link rel="modulepreload" href="/r-abc123/assets/vendor.js"></html>')
    respx.get(GRAVES + "/r-abc123/").respond(200, text=html)
    respx.get(GRAVES + "/r-abc123/assets/index.js").respond(200, text="x")
    respx.get(GRAVES + "/r-abc123/assets/vendor.js").respond(200, text="y %s z" % FN)
    out = pulse.check_wiring(GRAVES, "r-abc123", URL)
    assert out.ok and "vendor.js" in out.summary


# ---- failure in either half -----------------------------------------------------------------------

def test_backend_build_failure_names_the_api_and_releases_the_unused_slot(aws, monkeypatch):
    monkeypatch.setattr(logs, "tail", lambda rec, n=400, stream=None: ["ERROR: No matching distribution found for foo"])
    rec = fs_rec("backend")
    rec.quota_slot_pk = "quota#2026-11-04"
    aws.builds.status["apps:1"] = "FAILED"
    step(rec, 1)
    r = rec.res
    assert r.status == "failed" and r.ghost.cause.startswith("The API failed to start.")
    assert aws.released == [("quota#2026-11-04", 1)] and rec.quota_slot_pk is None
    assert aws.builds.frontend_calls == [] and gone(aws)


@respx.mock
def test_backend_crash_fails_fast_names_the_api_and_releases_the_slot(aws):
    rec = fs_rec("backend_pulse")
    rec.function_url, rec.pulse_started_at, rec.quota_slot_pk = URL, "2026-11-04T09:00:00Z", "quota#x"
    aws.logs.lines = ["INIT_REPORT Init Duration: 5 ms Phase: init Status: error Error Type: Runtime.ExitError"]
    respx.get(URL + "health").respond(502)
    respx.get(URL + "docs").respond(502)
    respx.get(URL + "").respond(502)
    step(rec, 3)                                                   # far below the 45 s deadline
    assert rec.res.status == "failed" and rec.res.phase_message == "The server crashed"
    assert rec.res.ghost.cause.startswith("The API failed to start.")
    assert aws.released == [("quota#x", 1)] and aws.builds.frontend_calls == [] and gone(aws)


@respx.mock
def test_backend_no_pulse_by_deadline(aws):
    rec = fs_rec("backend_pulse")
    rec.function_url, rec.pulse_started_at = URL, "2026-11-04T09:00:00Z"
    for p in ("health", "docs", ""):
        respx.get(URL + p).respond(500)
    step(rec, 60)
    assert rec.res.status == "failed" and rec.res.phase_message == "No pulse" and gone(aws)


def test_function_that_never_leaves_pending_fails_as_api(aws):
    rec = fs_rec("backend")
    rec.function_created_at = "2026-11-04T09:00:00Z"
    step(rec, 200)
    assert rec.res.status == "failed" and rec.res.ghost.cause.startswith("The API failed to start.")


def test_frontend_failure_after_live_backend_cleans_up_immediately(aws, monkeypatch):
    monkeypatch.setattr(logs, "tail", lambda rec, n=400, stream=None: ["npm ERR! missing script: build"]
                        if stream == "s-web:1" else ["wrong stream"])
    rec = fs_rec("frontend")
    rec.function_url, rec.fe_build_id = URL, "web:1"
    assert not gone(aws)
    aws.builds.status["web:1"] = "FAILED"
    step(rec, 1)
    r = rec.res
    assert r.status == "failed" and r.ghost.cause.startswith("The frontend build failed.")
    assert gone(aws)                                               # function, image tag and log group, now
    assert any("missing script" in ln for ln in r.ghost.raw_tail) and aws.released == []


def test_frontend_build_that_cannot_start_fails_and_cleans_up(aws):
    rec = fs_rec("backend_pulse")
    rec.function_url, rec.pulse_started_at = URL, "2026-11-04T09:00:00Z"
    aws.builds.fail_start = Err("AccessDeniedException")
    with respx.mock:
        respx.get(URL + "health").respond(200)
        step(rec, 1)
    assert rec.res.status == "failed" and rec.res.phase_message == "The frontend build would not start"
    assert rec.res.ghost.cause.startswith("The frontend build failed.") and gone(aws)


def test_create_function_error_fails_as_api(aws, monkeypatch):
    monkeypatch.setattr(aws.lam, "create_function", lambda **kw: (_ for _ in ()).throw(Err("AccessDeniedException")))
    aws.builds.status["apps:1"] = "SUCCEEDED"
    rec = fs_rec("backend")
    step(rec, 1)
    assert rec.res.status == "failed" and rec.res.ghost.cause.startswith("The API failed to start.")


# ---- expiry and the reaper ------------------------------------------------------------------------

def test_one_lifetime_for_both_halves_and_the_reaper_removes_everything_twice(aws, table, monkeypatch):
    rec = fs_rec("frontend_pulse", "checking_pulse")
    rec.function_url = URL
    with respx.mock:
        site("x %s" % FN)
        step(rec, 0)
    assert rec.res.expires_at == "2026-11-04T09:20:00Z"
    store.create(rec)
    s3 = FakeS3(["graves/r-abc123/index.html", "graves/r-abc123/assets/a.js", "graves/r-other1/index.html"])
    clients = {"s3": s3, "cloudfront": CF(), "lambda": aws.lam, "logs": aws.logs, "ecr": aws.ecr}
    monkeypatch.setattr(config, "client", lambda n: clients[n])
    monkeypatch.setenv("BUCKET", "b")
    assert reaper.handler({"id": "r-abc123"}, None)["result"] == "expired"
    assert s3.keys == ["graves/r-other1/index.html"] and gone(aws)
    assert store.get("r-abc123").res.status == "expired"
    assert reaper.handler({"id": "r-abc123"}, None)["result"] == "already"   # idempotent
    assert gone(aws)


def test_alive_record_expires_on_get_after_its_time(aws):
    rec = fs_rec("frontend_pulse", "alive")
    rec.res.expires_at = "2026-11-04T09:20:00Z"
    assert statemachine.advance(rec, "u", NOW + timedelta(minutes=21)) is True and rec.res.status == "expired"


# ---- service: guardrails, quota, retry, the flag --------------------------------------------------

class Counters:
    """Only the daily quota counter is tracked (`count`); the per-IP counter is left unlimited."""

    def __init__(self, limit_used=0):
        self.count, self.calls = limit_used, []

    def update_item(self, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames,
                    ExpressionAttributeValues):
        if not Key["pk"].startswith("quota#"):
            return
        self.calls.append((UpdateExpression, dict(ExpressionAttributeValues)))
        n = ExpressionAttributeValues.get(":one", ExpressionAttributeValues.get(":minus"))
        if ":limit" in ExpressionAttributeValues and self.count >= ExpressionAttributeValues[":limit"]:
            raise type("C", (Exception,), {"response": {"Error": {"Code": "ConditionalCheckFailedException"}}})()
        if ":minus" in ExpressionAttributeValues and self.count < ExpressionAttributeValues[":n"]:
            raise type("C", (Exception,), {"response": {"Error": {"Code": "ConditionalCheckFailedException"}}})()
        self.count += n


@pytest.fixture
def counters(monkeypatch):
    c = Counters()
    monkeypatch.setattr(limits, "_table", lambda: c)
    monkeypatch.setattr(limits, "_admin_secret", lambda: "s3cret")
    monkeypatch.setattr(limits, "_now", lambda: datetime(2026, 11, 4, 7, 15, 0, tzinfo=timezone.utc))
    monkeypatch.setenv("DAILY_BUILD_QUOTA", "50")
    return c


def test_two_builds_are_reserved_all_or_nothing(counters):
    counters.count = 48
    assert limits.reserve_build(None, 2) == "quota#2026-11-04" and counters.count == 50
    with pytest.raises(ApiException) as e:
        limits.reserve_build(None, 1)
    assert e.value.code == "quota_exhausted"
    counters.count = 49                                            # one left, but two are needed: nothing charged
    with pytest.raises(ApiException):
        limits.reserve_build(None, 2)
    assert counters.count == 49
    assert limits.reserve_build(None, 1) is not None and counters.count == 50


def test_admin_is_not_charged_and_release_is_safe(counters):
    assert limits.reserve_build("s3cret", 2) is None and counters.count == 0
    limits.release_build(None)                                     # nothing to give back
    counters.count = 5
    limits.release_build("quota#2026-11-04", 1)
    assert counters.count == 4
    counters.count = 0
    limits.release_build("quota#2026-11-04", 1)                    # never below zero, never raises
    assert counters.count == 0


def stub_run(monkeypatch, fullstack=True):
    a = make_autopsy(verdict="healthy", stack="react-vite", app_dir="frontend")
    res = autopsy.AutopsyResult(
        a, RepoRef(owner="o", name="n", url="https://github.com/o/n", default_branch="main", commit_sha="abc"), None,
        backend=INFO if fullstack else None, fullstack=fs_info() if fullstack else None)
    monkeypatch.setattr(autopsy, "run", lambda parsed: res)


@pytest.fixture
def started(monkeypatch):
    calls = []
    monkeypatch.setattr(builds, "start", lambda *a, **k: calls.append((a, k)) or "apps:1")
    return calls


def test_create_reserves_two_and_starts_the_backend_in_its_own_folder(aws, table, started, monkeypatch):
    stub_run(monkeypatch)
    reserved = []
    monkeypatch.setattr(limits, "reserve_build", lambda admin, count=1: reserved.append(count) or "quota#k")
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert reserved == [2] and rec.fs_stage == "backend" and rec.quota_slot_pk == "quota#k"
    (args, kw), = started
    assert args[3] == "backend" and kw["backend"] == INFO         # backend_dir, not the frontend folder
    assert rec.res.status == "summoning" and rec.res.stack == "react-vite" and rec.fullstack is not None


def test_create_with_quota_left_for_only_one_build_is_refused_without_building(aws, table, started, counters, monkeypatch):
    counters.count = 49
    stub_run(monkeypatch)
    with pytest.raises(ApiException) as e:
        service.create("https://github.com/o/n", "1.1.1.1", None)
    assert e.value.code == "quota_exhausted" and started == [] and counters.count == 49


def test_a_build_that_cannot_start_gives_both_slots_back(table, monkeypatch, counters):
    monkeypatch.setattr(functions, "count_live", lambda: 0)
    stub_run(monkeypatch)
    monkeypatch.setattr(builds, "start", lambda *a, **k: (_ for _ in ()).throw(Err("AccessDeniedException")))
    with pytest.raises(Err):
        service.create("https://github.com/o/n", "1.1.1.1", None)
    assert counters.count == 0                                     # reserved 2, gave 2 back


def test_live_cap_counts_a_full_stack_repo_as_one_backend(aws, table, started, monkeypatch):
    monkeypatch.setenv("MAX_LIVE_BACKENDS", "2")
    aws.lam.functions = {"rz-one": {}}
    stub_run(monkeypatch)
    assert service.create("https://github.com/o/n", "1.1.1.1", None).res.status == "summoning"
    aws.lam.functions = {"rz-one": {}, "rz-two": {}}
    quota = []
    monkeypatch.setattr(limits, "reserve_build", lambda *a: quota.append(a))
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.res.status == "cannot_rise" and rec.fullstack is None and rec.backend is None and quota == []
    assert any(f.id == "too-many-backends" for f in rec.res.autopsy.findings)


def test_retry_from_failed_reruns_both_halves(aws, table, started, monkeypatch):
    stub_run(monkeypatch)
    reserved = []
    monkeypatch.setattr(limits, "reserve_build", lambda admin, count=1: reserved.append(count) or "quota#k")
    rec = fs_rec("frontend", "failed")
    rec.res.ghost = "x"
    rec.fe_build_id, rec.fe_log_stream, rec.fe_pulse_offset, rec.log_stream = "web:1", "s-web:1", 3, "s-apps:1"
    rec.function_url, rec.function_created_at = URL, "2026-11-04T09:00:00Z"
    rec.pulse_lines = [LogLine(ts="2026-11-04T09:00:00Z", text="x", kind="pulse")]
    rec.res.ghost = None
    rec.res.status = "failed"
    store.create(rec)
    got = service.retry("r-abc123", "1.1.1.1", None)
    assert got.res.status == "summoning" and got.res.attempt == 2 and reserved == [2]
    assert got.fs_stage == "backend" and got.build_id == "apps:1"
    assert (got.fe_build_id, got.fe_log_stream, got.fe_pulse_offset, got.function_url, got.log_stream) == (None,) * 5
    assert got.pulse_lines == [] and started[0][0][3] == "backend"


FILES = {"frontend/package.json": json.dumps({"dependencies": {"react": "1", "vite": "5"}, "scripts": {"build": "x"}}),
         "frontend/src/App.jsx": "fetch(import.meta.env.VITE_API_URL)",
         "backend/requirements.txt": "fastapi\n", "backend/main.py": "app = FastAPI()\n"}
PATHS = ["frontend/package.json", "frontend/index.html", "frontend/src/App.jsx",
         "backend/requirements.txt", "backend/main.py"]


def fake_github(monkeypatch):
    monkeypatch.setattr(github, "fetch_repo", lambda *a: {"owner": {"login": "o"}, "name": "n", "default_branch": "main"})
    monkeypatch.setattr(github, "fetch_tree_and_sha", lambda *a: (PATHS, "abc1234"))
    monkeypatch.setattr(github, "fetch_raw_files",
                        lambda c, o, n, b, wanted: {p: FILES[p] for p in wanted if p in FILES})
    monkeypatch.setattr(service.github if hasattr(service, "github") else github, "parse_repo_url",
                        lambda u: github.ParsedUrl("o", "n", None))


def test_with_the_flag_on_a_full_stack_repo_takes_the_full_stack_path(table, started, monkeypatch):
    """End to end through the real autopsy: the repo has frontend/ and backend/."""
    fake_github(monkeypatch)
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    monkeypatch.setenv("FULLSTACK_ENABLED", "true")
    monkeypatch.setattr(functions, "count_live", lambda: 0)
    reserved = []
    monkeypatch.setattr(limits, "reserve_build", lambda admin, count=1: reserved.append(count))
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.fullstack is not None and rec.backend is not None and rec.fs_stage == "backend"
    assert (rec.res.stack, rec.res.autopsy.app_dir) == ("react-vite", "frontend")
    (args, kw), = started
    assert args[3] == "backend" and kw["backend"].framework == "fastapi" and reserved == [2]


def test_with_the_flag_off_the_same_repo_still_picks_frontend_only(table, started, monkeypatch):
    fake_github(monkeypatch)
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    monkeypatch.setenv("FULLSTACK_ENABLED", "false")
    reserved = []
    monkeypatch.setattr(limits, "reserve_build", lambda admin, count=1: reserved.append(count))
    touched = []
    monkeypatch.setattr(functions, "count_live", lambda: touched.append("lambda") or 0)
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.fullstack is None and rec.backend is None and rec.fs_stage is None
    assert rec.res.autopsy.app_dir == "frontend" and reserved == [1] and touched == []
    (args, kw), = started
    assert args[3] == "frontend" and "backend" not in kw
    assert not any(f.id.startswith("fullstack") for f in rec.res.autopsy.findings)


def test_flag_off_records_never_reach_the_full_stack_machine(aws, monkeypatch):
    from app import fullstack
    monkeypatch.setattr(fullstack, "advance", lambda *a, **k: (_ for _ in ()).throw(AssertionError("used")))
    aws.builds.status["web:1"] = "IN_PROGRESS"
    rec = make_record("building", build_id="web:1")
    rec.res.status = "building"
    statemachine.advance(rec, "u", NOW)                             # would raise if it went down the new path
    assert "fullstack" not in rec.to_api("2026-11-04T09:00:00Z")


def test_internal_fields_never_reach_the_api():
    out = fs_rec().to_api("2026-11-04T09:00:00Z")
    assert not {"fullstack", "fe_build_id", "fe_log_stream", "fe_pulse_offset", "fs_stage", "quota_slot_pk",
                "function_url", "backend"} & set(out)


# ---- logs: two streams, one cursor ----------------------------------------------------------------

class TwoStreams:
    def __init__(self):
        self.streams = {"s-apps:1": [], "s-web:1": []}

    def add(self, stream, text, i):
        self.streams[stream].append({"timestamp": 1_762_241_400_000 + i * 1000, "message": text})

    def get_log_events(self, logGroupName, logStreamName, startFromHead=True, nextToken=None, limit=None):
        if logStreamName not in self.streams:
            raise Err("ResourceNotFoundException")
        ev = self.streams[logStreamName]
        start = int(nextToken.split("/")[1]) if nextToken else 0
        return {"events": ev[start:], "nextForwardToken": "f/%d" % len(ev)}


def test_logs_show_backend_then_the_server_line_then_frontend_and_the_cursor_spans_both(monkeypatch):
    cw = TwoStreams()
    monkeypatch.setattr(config, "client", lambda n: cw)
    rec = fs_rec("backend_pulse")
    rec.log_stream = "s-apps:1"
    cw.add("s-apps:1", "backend: pip install", 1)
    cw.add("s-apps:1", "backend: image pushed", 2)
    rec.pulse_lines = [LogLine(ts="2026-11-04T09:00:03Z", kind="pulse", text="API pulse check 1: ok")]
    first = logs.fetch(rec, None)
    assert [ln.text for ln in first.lines] == ["backend: pip install", "backend: image pushed", "API pulse check 1: ok"]
    # the hand-over, then the frontend build starts and ends
    rec.pulse_lines.append(LogLine(ts="2026-11-04T09:00:04Z", kind="system",
                                   text="The server lives at %s. Now building the frontend." % FN))
    rec.fe_pulse_offset = 2
    rec.fe_log_stream = "s-web:1"
    cw.add("s-web:1", "frontend: vite build", 5)
    rec.pulse_lines.append(LogLine(ts="2026-11-04T09:00:09Z", kind="pulse", text="Pulse check 1/20: up"))
    second = logs.fetch(rec, first.cursor)
    assert [ln.text for ln in second.lines] == [
        "The server lives at %s. Now building the frontend." % FN, "frontend: vite build", "Pulse check 1/20: up"]
    assert second.new_events is True
    third = logs.fetch(rec, second.cursor)                         # nothing new: no repeats
    assert third.lines == [] and third.new_events is False
    cw.add("s-web:1", "frontend: uploaded", 6)
    fourth = logs.fetch(rec, third.cursor)
    assert [ln.text for ln in fourth.lines] == ["frontend: uploaded"]


def test_single_build_cursors_are_unchanged():
    raw = json.loads(base64.urlsafe_b64decode(logs.encode_cursor("tok", 3) + "=="))
    assert raw == {"t": "tok", "p": 3}
    assert logs.decode_cursor(logs.encode_cursor("tok", 3, "t2")) == ("tok", 3)
