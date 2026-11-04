"""B4 Phase 4: backend functions, state machine, pulse, reaper, live cap. All AWS is faked."""
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from app import bedrock, builds, config, expiry, functions, limits, pulse, reaper, service, statemachine, store
from app.models import BackendInfo
from tests.helpers import make_autopsy, make_record

NOW = datetime(2026, 11, 4, 9, 0, 0, tzinfo=timezone.utc)
URL = "https://abc123.lambda-url.us-east-1.on.aws/"
INFO = BackendInfo(framework="fastapi", runtime="python", entry="uvicorn main:app --host 0.0.0.0 --port 8000",
                   app_port=8000, live_path="/docs", probe_paths=["/health", "/docs", "/"])


class Err(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeLambda:
    def __init__(self, existing=0):
        self.calls, self.fn_state, self.reason, self.code = [], "Pending", None, None
        self.functions = {"rz-old%03d" % i: {} for i in range(existing)}
        self.conflict_all = False

    def create_function(self, **kw):
        self.calls.append(("create_function", kw))
        if kw["FunctionName"] in self.functions or self.conflict_all:
            raise Err("ResourceConflictException")
        self.functions[kw["FunctionName"]] = kw

    def create_function_url_config(self, **kw):
        self.calls.append(("create_function_url_config", kw))
        if self.conflict_all:
            raise Err("ResourceConflictException")
        return {"FunctionUrl": URL}

    def get_function_url_config(self, **kw):
        self.calls.append(("get_function_url_config", kw))
        return {"FunctionUrl": URL}

    def add_permission(self, **kw):
        self.calls.append(("add_permission", kw))
        if self.conflict_all:
            raise Err("ResourceConflictException")

    def get_function(self, FunctionName):
        self.calls.append(("get_function", FunctionName))
        if FunctionName not in self.functions:
            raise Err("ResourceNotFoundException")
        return {"Configuration": {"State": self.fn_state, "StateReason": self.reason,
                                  "StateReasonCode": self.code, "LastUpdateStatus": "Successful"}}

    def delete_function(self, FunctionName):
        self.calls.append(("delete_function", FunctionName))
        if FunctionName not in self.functions:
            raise Err("ResourceNotFoundException")
        del self.functions[FunctionName]

    def list_functions(self, Marker=None):
        names = sorted(self.functions) + ["resurrect-api", "resurrect-reaper"]
        if Marker is None:
            return {"Functions": [{"FunctionName": n} for n in names[:2]], "NextMarker": "m2"}
        return {"Functions": [{"FunctionName": n} for n in names[2:]]}


class FakeLogs:
    def __init__(self, lines=()):
        self.lines, self.calls, self.groups = list(lines), [], set()

    def create_log_group(self, logGroupName):
        self.calls.append(("create_log_group", logGroupName))
        if logGroupName in self.groups:
            raise Err("ResourceAlreadyExistsException")
        self.groups.add(logGroupName)

    def put_retention_policy(self, logGroupName, retentionInDays):
        self.calls.append(("put_retention_policy", logGroupName, retentionInDays))

    def filter_log_events(self, **kw):
        self.calls.append(("filter_log_events", kw["logGroupName"]))
        return {"events": [{"message": ln} for ln in self.lines]}

    def delete_log_group(self, logGroupName):
        self.calls.append(("delete_log_group", logGroupName))
        if logGroupName not in self.groups:
            raise Err("ResourceNotFoundException")
        self.groups.discard(logGroupName)


class FakeEcr:
    def __init__(self, tags=()):
        self.tags, self.calls = set(tags), []

    def batch_delete_image(self, repositoryName, imageIds):
        self.calls.append((repositoryName, imageIds))
        tag = imageIds[0]["imageTag"]
        if tag in self.tags:
            self.tags.discard(tag)
            return {"imageIds": imageIds, "failures": []}
        return {"imageIds": [], "failures": [{"failureCode": "ImageNotFound"}]}


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("ECR_APPS_URI", "123.dkr.ecr.us-east-1.amazonaws.com/resurrect-apps")
    monkeypatch.setenv("APP_EXEC_ROLE_ARN", "arn:aws:iam::123:role/resurrect-app-exec")
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    fake = type("AWS", (), {})()
    fake.lam, fake.logs, fake.ecr = FakeLambda(), FakeLogs(), FakeEcr(["r-abc123"])
    fake.logs.groups.add("/aws/lambda/rz-r-abc123")
    monkeypatch.setattr(config, "client", lambda n: {"lambda": fake.lam, "logs": fake.logs, "ecr": fake.ecr}[n])
    monkeypatch.setattr(expiry, "schedule", lambda res: fake.__dict__.setdefault("scheduled", []).append(res.id))
    return fake


def backend_rec(status="building", **kw):
    rec = make_record(status, stack="python", **kw)
    rec.backend = INFO
    return rec


def ghost_spy(monkeypatch, reply=None):
    seen = {}

    def fake(system, user, max_tokens=500, timeout_s=8):
        seen["user"] = user
        return reply
    monkeypatch.setattr(bedrock, "converse_json", fake)
    return seen


# ---- functions.create ------------------------------------------------------------------

def test_create_parameters_and_order(aws):
    aws.logs.groups.clear()
    url = functions.create("r-abc123", INFO)
    assert url == URL
    names = [c[0] for c in aws.logs.calls] + [c[0] for c in aws.lam.calls]
    assert names.index("create_log_group") < names.index("create_function")
    assert ("put_retention_policy", "/aws/lambda/rz-r-abc123", 1) in aws.logs.calls
    kw = dict(aws.lam.calls)["create_function"]
    assert kw["FunctionName"] == "rz-r-abc123" and kw["PackageType"] == "Image"
    assert kw["Code"] == {"ImageUri": "123.dkr.ecr.us-east-1.amazonaws.com/resurrect-apps:r-abc123"}
    assert kw["Role"].endswith("resurrect-app-exec") and kw["MemorySize"] == 1024 and kw["Timeout"] == 30
    assert kw["EphemeralStorage"] == {"Size": 1024} and kw["Architectures"] == ["x86_64"]
    assert kw["Tags"] == {"resurrect-id": "r-abc123"} and "DATABASE_URL" in kw["Environment"]["Variables"]
    assert dict(aws.lam.calls)["create_function_url_config"]["AuthType"] == "NONE"
    perms = [c[1] for c in aws.lam.calls if c[0] == "add_permission"]
    assert {p["Action"] for p in perms} == {"lambda:InvokeFunctionUrl", "lambda:InvokeFunction"}
    assert not any("Concurrency" in c[0] for c in aws.lam.calls)  # account limit is 10: never reserve


def test_create_is_idempotent(aws):
    functions.create("r-abc123", INFO)
    aws.lam.conflict_all = True
    assert functions.create("r-abc123", INFO) == URL  # every step conflicts, still fine
    assert ("get_function_url_config", {"FunctionName": "rz-r-abc123"}) in aws.lam.calls


def test_create_real_errors_propagate(aws, monkeypatch):
    def boom(**kw):
        raise Err("AccessDeniedException")
    monkeypatch.setattr(aws.lam, "create_function", boom)
    with pytest.raises(Err):
        functions.create("r-abc123", INFO)


def test_count_live_counts_only_rz_functions_across_pages(aws):
    aws.lam.functions = {"rz-a": {}, "rz-b": {}, "rz-c": {}}
    assert functions.count_live() == 3


# ---- state machine: Pending -> Active -> pulse -> alive ----------------------------------

def test_build_success_creates_function_and_stays_building(aws, monkeypatch):
    rec = backend_rec()
    monkeypatch.setattr(builds, "get", lambda b: {"status": "SUCCEEDED", "log_stream": "s"})
    assert statemachine.advance(rec, "https://api", NOW) is True
    assert rec.res.status == "building" and rec.res.phase_message == "Raising the server"
    assert rec.function_url == URL and rec.function_created_at


def test_full_happy_path(aws, monkeypatch):
    rec = backend_rec()
    monkeypatch.setattr(builds, "get", lambda b: {"status": "SUCCEEDED", "log_stream": "s"})
    statemachine.advance(rec, "https://api", NOW)
    n_create = sum(1 for c in aws.lam.calls if c[0] == "create_function")
    # the next polls must NOT create again or re-read CodeBuild
    monkeypatch.setattr(builds, "get", lambda b: (_ for _ in ()).throw(AssertionError("build re-read")))
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=2)) is False   # Pending
    assert rec.res.status == "building"
    aws.lam.fn_state = "Active"
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=4)) is True
    assert rec.res.status == "checking_pulse" and rec.pulse_started_at and rec.res.pulse.attempts == 0
    assert sum(1 for c in aws.lam.calls if c[0] == "create_function") == n_create
    seen = {}
    monkeypatch.setattr(pulse, "probe_backend", lambda url, paths: seen.update(url=url, paths=paths) or
                        pulse.ProbeResult(True, "ok", ["GET /docs -> 200"]))
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=7))
    r = rec.res
    assert r.status == "alive" and r.live_url == "https://abc123.lambda-url.us-east-1.on.aws/docs"
    assert seen == {"url": URL, "paths": ["/health", "/docs", "/"]}
    assert r.expires_at and aws.scheduled == ["r-abc123"]          # same 20-minute expiry path


def test_function_failed_gives_ghost_with_reason_code_and_frees_the_slot(aws, monkeypatch):
    aws.lam.functions["rz-r-abc123"] = {}
    aws.lam.fn_state, aws.lam.code, aws.lam.reason = "Failed", "ImageAccessDenied", "Lambda does not have permission"
    aws.logs.lines = ["Traceback (most recent call last):", "ImportError: No module named 'sqlalchemy'"]
    seen = ghost_spy(monkeypatch, {"cause": "sqlalchemy is missing", "fix": "Add it to requirements.txt",
                                   "command": None, "confidence": "high"})
    rec = backend_rec()
    rec.function_url, rec.function_created_at = URL, "2026-11-04T09:00:00Z"
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=5)) is True
    assert rec.res.status == "failed" and rec.res.ghost.source == "llm"
    assert "ImageAccessDenied" in seen["user"] and "ImportError: No module named" in seen["user"]
    assert "rz-r-abc123" not in aws.lam.functions and ("delete_log_group", "/aws/lambda/rz-r-abc123") in aws.logs.calls
    assert aws.ecr.calls  # image removed too


def test_pending_over_three_minutes_fails(aws, monkeypatch):
    aws.lam.functions["rz-r-abc123"] = {}
    ghost_spy(monkeypatch)
    rec = backend_rec()
    rec.function_url, rec.function_created_at = URL, "2026-11-04T09:00:00Z"
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=170)) is False
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=181)) is True
    assert rec.res.status == "failed" and rec.res.ghost.source == "fallback"


def test_create_failure_fails_with_ghost(aws, monkeypatch):
    def boom(**kw):
        raise Err("AccessDeniedException")
    monkeypatch.setattr(aws.lam, "create_function", boom)
    seen = ghost_spy(monkeypatch)
    rec = backend_rec()
    monkeypatch.setattr(builds, "get", lambda b: {"status": "SUCCEEDED", "log_stream": "s"})
    statemachine.advance(rec, "https://api", NOW)
    assert rec.res.status == "failed" and "AccessDeniedException" in seen["user"]


def test_pulse_failure_uses_probe_results_plus_function_logs_scrubbed(aws, monkeypatch):
    aws.lam.functions["rz-r-abc123"] = {}
    aws.logs.lines = ["START RequestId: x", "pymongo.errors.ServerSelectionTimeoutError: localhost:27017",
                      "MONGO_URL=mongodb://admin:hunter2@localhost"]
    seen = ghost_spy(monkeypatch)
    rec = backend_rec("checking_pulse")
    rec.function_url, rec.function_created_at = URL, "2026-11-04T09:00:00Z"
    rec.pulse_started_at = "2026-11-04T09:00:00Z"
    from app.models import Pulse
    rec.res.pulse = Pulse(attempts=3, max_attempts=20)
    monkeypatch.setattr(pulse, "probe_backend",
                        lambda url, paths: pulse.ProbeResult(False, "5xx", ["GET %s/health -> 502" % URL]))
    # 61 s in: a static site would be failed by now, a backend still has until 90 s
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=61)) is True
    assert rec.res.status == "checking_pulse"
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=91))
    assert rec.res.status == "failed" and rec.res.phase_message == "No pulse"
    assert "ServerSelectionTimeoutError" in seen["user"] and "GET" in seen["user"]
    assert "hunter2" not in seen["user"] and "START RequestId" not in seen["user"]
    assert not any("hunter2" in ln for ln in rec.res.ghost.raw_tail)
    assert "rz-r-abc123" not in aws.lam.functions


# ---- probe_backend --------------------------------------------------------------------------

@respx.mock
def test_probe_alive_on_any_status_below_500():
    respx.get(URL + "health").respond(404)
    assert pulse.probe_backend(URL, ["/health", "/docs"]).ok


@respx.mock
def test_probe_tries_next_path_after_5xx():
    respx.get(URL + "health").respond(502)
    respx.get(URL + "docs").respond(200)
    r = pulse.probe_backend(URL, ["/health", "/docs"])
    assert r.ok and len(r.details) == 2


@respx.mock
def test_probe_all_5xx_and_timeout_and_forbidden_fail():
    respx.get(URL + "health").respond(500)
    respx.get(URL + "docs").respond(503)
    assert not pulse.probe_backend(URL, ["/health", "/docs"]).ok
    respx.get(URL + "health").mock(side_effect=httpx.ReadTimeout("slow"))
    r = pulse.probe_backend(URL, ["/health", "/docs"])
    assert not r.ok and len(r.details) == 1                       # stops at the first timeout
    respx.get(URL + "health").respond(403, json={"Message": "Forbidden"})
    r = pulse.probe_backend(URL, ["/health"])
    assert not r.ok and "not public" in r.summary                 # missing public permission is not "alive"
    respx.get(URL + "health").respond(403, text="CSRF verification failed")
    assert pulse.probe_backend(URL, ["/health"]).ok               # an app's own 403 is fine


# ---- builds.start picks the project ------------------------------------------------------------

class FakeCodeBuild:
    def __init__(self):
        self.kw = None

    def start_build(self, **kw):
        self.kw = kw
        return {"build": {"id": "p:1"}}


def test_builds_start_picks_project_by_backend(monkeypatch):
    cb = FakeCodeBuild()
    monkeypatch.setattr(config, "client", lambda n: cb)
    monkeypatch.setenv("ECR_APPS_URI", "123.dkr.ecr.us-east-1.amazonaws.com/resurrect-apps")
    builds.start("r-abc123", "https://github.com/o/n", "react-vite", ".", "abc")
    assert cb.kw["projectName"] == "resurrect-build"
    env = {e["name"]: e["value"] for e in cb.kw["environmentVariablesOverride"]}
    assert env["STACK"] == "react-vite" and "RUNTIME" not in env
    builds.start("r-abc123", "https://github.com/o/n", "python", "backend", "abc", backend=INFO)
    assert cb.kw["projectName"] == "resurrect-build-apps"
    env = {e["name"]: e["value"] for e in cb.kw["environmentVariablesOverride"]}
    assert env["RUNTIME"] == "python" and env["APP_PORT"] == "8000" and env["APP_DIR"] == "backend"
    assert env["ENTRY"].startswith("uvicorn") and env["ECR_APPS_URI"].endswith("resurrect-apps")
    assert "BUCKET" not in env  # the backend build project has no S3 access and gets no bucket


# ---- service: live cap, quota, flag off -----------------------------------------------------------

def stub_autopsy(monkeypatch, backend):
    from app import autopsy
    from app.models import RepoRef
    a = make_autopsy(verdict="healthy", stack="python", app_dir="backend")
    res = autopsy.AutopsyResult(a, RepoRef(owner="o", name="n", url="https://github.com/o/n",
                                           default_branch="main", commit_sha="abc"), None, backend=backend)
    monkeypatch.setattr(autopsy, "run", lambda parsed: res)


@pytest.fixture
def started(monkeypatch):
    calls = []
    monkeypatch.setattr(builds, "start", lambda *a, **k: calls.append((a, k)) or "p:1")
    return calls


def test_backend_build_starts_under_the_cap(aws, table, started, monkeypatch):
    monkeypatch.setenv("MAX_LIVE_BACKENDS", "2")
    aws.lam.functions = {"rz-one": {}}
    stub_autopsy(monkeypatch, INFO)
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.res.status == "summoning" and rec.res.deployable and len(started) == 1
    assert started[0][1]["backend"] == INFO


def test_live_cap_reached_gives_cannot_rise_without_build_or_quota(aws, table, started, monkeypatch):
    monkeypatch.setenv("MAX_LIVE_BACKENDS", "2")
    aws.lam.functions = {"rz-one": {}, "rz-two": {}}
    quota = []
    monkeypatch.setattr(limits, "reserve_build", lambda admin: quota.append(1))
    stub_autopsy(monkeypatch, INFO)
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    r = rec.res
    assert r.status == "cannot_rise" and not r.deployable and started == [] and quota == []
    f = [f for f in r.autopsy.findings if f.id == "too-many-backends"][0]
    assert f.detail == "Too many backends are awake right now; try again in a few minutes."
    assert r.autopsy.verdict == "blocked" and rec.backend is None


def test_cap_defaults_to_two(monkeypatch):
    monkeypatch.delenv("MAX_LIVE_BACKENDS", raising=False)
    assert config.settings().max_live_backends == 2


def test_flag_off_makes_zero_lambda_calls(table, started, monkeypatch):
    """With BACKENDS_ENABLED off the autopsy never yields backend info, so no AWS client is touched."""
    from app import autopsy

    monkeypatch.delenv("BACKENDS_ENABLED", raising=False)
    touched = []
    monkeypatch.setattr(config, "client", lambda n: touched.append(n) or (_ for _ in ()).throw(AssertionError(n)))
    a, _, info = autopsy.analyze_ex(["requirements.txt", "main.py"],
                                    {"requirements.txt": "fastapi", "main.py": "app = FastAPI()\n"})
    assert info is None and a.verdict == "blocked"
    stub_autopsy(monkeypatch, None)  # blocked python repo, as today
    monkeypatch.setattr(autopsy, "is_deployable", lambda a, b=None: False)
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.res.status == "cannot_rise" and touched == [] and started == []


def test_static_builds_do_not_use_backend_path(aws, table, started, monkeypatch):
    from app import autopsy
    from app.models import RepoRef
    a = make_autopsy(verdict="healthy", stack="react-vite")
    monkeypatch.setattr(autopsy, "run", lambda p: autopsy.AutopsyResult(
        a, RepoRef(owner="o", name="n", url="https://github.com/o/n", default_branch="main", commit_sha="x"), None))
    rec = service.create("https://github.com/o/n", "1.1.1.1", None)
    assert rec.res.status == "summoning" and "backend" not in started[0][1]
    assert not [c for c in aws.lam.calls if c[0] != "x"]


# ---- reaper ---------------------------------------------------------------------------------------

class NoS3:
    def list_objects_v2(self, **kw):
        return {}


class CF:
    def create_invalidation(self, **kw):
        return {"Invalidation": {"Id": "I1"}}


def wire_reaper(aws, monkeypatch):
    clients = {"s3": NoS3(), "cloudfront": CF(), "lambda": aws.lam, "logs": aws.logs, "ecr": aws.ecr}
    monkeypatch.setattr(config, "client", lambda n: clients[n])


def test_reaper_cleans_function_image_and_log_group_and_is_idempotent(aws, table, monkeypatch, caplog):
    rec = backend_rec("alive", expires_at="2026-11-04T09:20:00Z")
    store.create(rec)
    aws.lam.functions["rz-r-abc123"] = {}
    wire_reaper(aws, monkeypatch)
    with caplog.at_level("INFO"):
        out = reaper.handler({"id": "r-abc123"}, None)
    assert out["result"] == "expired"
    assert "rz-r-abc123" not in aws.lam.functions and "r-abc123" not in aws.ecr.tags
    assert "/aws/lambda/rz-r-abc123" not in aws.logs.groups
    line = [json.loads(r.message) for r in caplog.records if r.message.startswith("{")][-1]
    assert line["backend_cleanup"] == {"function": True, "image": True, "log_group": True}
    again = reaper.handler({"id": "r-abc123"}, None)           # second run: everything already gone
    assert again["result"] == "already"
    assert store.get("r-abc123").res.status == "expired" and store.get("r-abc123").version == 2


def test_reaper_skips_pinned_backend_and_never_touches_lambda_for_static(aws, table, monkeypatch):
    store.create(backend_rec("alive", pinned=True))
    aws.lam.functions["rz-r-abc123"] = {}
    wire_reaper(aws, monkeypatch)
    assert reaper.handler({"id": "r-abc123"}, None)["result"] == "pinned_skipped"
    assert "rz-r-abc123" in aws.lam.functions
    static = make_record("alive", id="r-stat01", expires_at="2026-11-04T09:20:00Z")
    store.create(static)
    reaper.handler({"id": "r-stat01"}, None)
    assert not [c for c in aws.lam.calls if c[0] == "delete_function"]
