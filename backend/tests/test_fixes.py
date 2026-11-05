"""Fixes after the live test matrix: fail fast, ghost and finding copy, framework naming, index.html,
requirements.txt. Everything is local; AWS and Bedrock are faked."""
import json
from datetime import timedelta

import pytest

from app import autopsy, bedrock, detect, functions, ghost, pulse, statemachine
from app.models import Finding, Pulse
from tests.helpers import make_record
from tests.test_backends import NOW, URL, aws, backend_rec, ghost_spy  # noqa: F401  (aws is a fixture)


def pkg(deps=None, scripts=None):
    return json.dumps({"name": "x", "dependencies": deps or {}, "scripts": scripts or {}})


def on(paths, files=None):
    return autopsy.analyze_ex(paths, files or {}, backends=True)


def off(paths, files=None):
    return autopsy.analyze_ex(paths, files or {}, backends=False)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    """The model is never reached unless a test installs its own spy."""
    monkeypatch.setattr(bedrock, "converse_json", lambda *a, **k: None)


def ids(a, severity=None):
    return {f.id for f in a.findings if severity is None or f.severity == severity}


# ---------------------------------------------------------------- 1. fail fast

CRASH = ["EXTENSION\tName: lambda-adapter\tState: Ready\tEvents: []",
         "INIT_REPORT Init Duration: 246.21 ms\tPhase: invoke\tStatus: error\tError Type: Runtime.ExitError",
         "sh: 1: nodemon: not found"]


def pulsing_backend(aws, monkeypatch, lines):
    aws.lam.functions["rz-r-abc123"] = {}
    aws.logs.lines = lines
    rec = backend_rec("checking_pulse")
    rec.function_url, rec.function_created_at = URL, "2026-11-04T09:00:00Z"
    rec.pulse_started_at = "2026-11-04T09:00:00Z"
    rec.res.pulse = Pulse(attempts=0, max_attempts=20)
    monkeypatch.setattr(pulse, "probe_backend",
                        lambda url, paths: pulse.ProbeResult(False, "5xx", ["GET %s/health -> 502" % URL]))
    return rec


def test_crash_in_logs_fails_on_the_first_poll_not_after_the_deadline(aws, monkeypatch):
    seen = ghost_spy(monkeypatch, {"cause": "nodemon is missing", "fix": "Change start to node index.js",
                                   "command": None, "confidence": "high"})
    rec = pulsing_backend(aws, monkeypatch, CRASH)
    assert statemachine.advance(rec, "https://api", NOW + timedelta(seconds=4)) is True   # 4 s, not 45 s
    assert rec.res.status == "failed" and rec.res.phase_message == "The server crashed"
    assert "Runtime.ExitError" in seen["user"] and "nodemon: not found" in seen["user"]
    assert rec.res.ghost.source == "llm"
    assert "rz-r-abc123" not in aws.lam.functions                      # slot freed
    assert ("delete_log_group", "/aws/lambda/rz-r-abc123") in aws.logs.calls


def test_logs_are_read_once_per_failure(aws, monkeypatch):
    ghost_spy(monkeypatch)
    rec = pulsing_backend(aws, monkeypatch, CRASH)
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=4))
    assert [c[0] for c in aws.logs.calls].count("filter_log_events") == 1


def test_slow_start_without_a_crash_keeps_waiting_until_45_seconds(aws, monkeypatch):
    ghost_spy(monkeypatch)
    rec = pulsing_backend(aws, monkeypatch, ["START RequestId: x", "Loading models..."])
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=44))
    assert rec.res.status == "checking_pulse"
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=46))
    assert rec.res.status == "failed" and rec.res.phase_message == "No pulse"


def test_backend_pulse_deadline_is_45_seconds():
    assert statemachine.BACKEND_PULSE_DEADLINE_S == 45


def test_a_healthy_app_is_not_failed_for_old_error_logs(aws, monkeypatch):
    rec = pulsing_backend(aws, monkeypatch, CRASH)
    monkeypatch.setattr(pulse, "probe_backend", lambda url, paths: pulse.ProbeResult(True, "ok", ["GET / -> 200"]))
    monkeypatch.setattr(statemachine.expiry, "schedule", lambda r: None)
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=4))
    assert rec.res.status == "alive"


def test_static_sites_keep_their_60_second_deadline_and_never_read_app_logs(aws, monkeypatch):
    rec = make_record("checking_pulse")
    rec.pulse_started_at = "2026-11-04T09:00:00Z"
    rec.res.pulse = Pulse(attempts=0, max_attempts=20)
    monkeypatch.setattr(pulse, "probe", lambda g, i: pulse.ProbeResult(False, "404", ["GET -> 404"]))
    statemachine.advance(rec, "https://api", NOW + timedelta(seconds=50))
    assert rec.res.status == "checking_pulse"
    assert aws.logs.calls == []


@pytest.mark.parametrize("line,hit", [
    ("INIT_REPORT Init Duration: 3774.28 ms\tPhase: invoke\tStatus: error\tError Type: Runtime.ExitError", True),
    ("RequestId: x Error: Runtime exited with error: exit status 1\nRuntime.ExitError", True),
    ("Runtime.ImportModuleError: Unable to import module", True),
    ("INIT_REPORT Init Duration: 800 ms\tPhase: init", False),
    ("Traceback (most recent call last):", False),     # an app error on one request is not a dead app
    ("Task timed out after 30.00 seconds", False),      # slow is not crashed
])
def test_crash_line(line, hit):
    assert (functions.crash_line(["ok", line]) is not None) is hit


# --------------------------------------------- 2, 8. ghost copy for known failures

def spy_model(monkeypatch):
    calls = []
    monkeypatch.setattr(bedrock, "converse_json", lambda *a, **k: calls.append(1))
    return calls


@pytest.mark.parametrize("line,pkg_name", [
    ("#11 8.132   ERROR: Failed building wheel for greenlet", "greenlet"),
    ("ERROR: Could not build wheels for cryptography, which is required to install pyproject.toml-based projects",
     "cryptography"),
    ("ERROR: No matching distribution found for anyio==3.6.1", "anyio"),
    ("ERROR: Could not find a version that satisfies the requirement pydantic==1.9.0 (from versions: none)",
     "pydantic"),
])
def test_old_pinned_python_package_gets_the_pin_fix_not_a_dockerfile(monkeypatch, line, pkg_name):
    calls = spy_model(monkeypatch)
    g = ghost.explain("python", [], None, ["step 1", line, "#11 ERROR: process did not complete"])
    assert calls == []                                    # no model call, no chance of a wrong fix
    assert pkg_name in g.cause and "Python 3.12" in g.cause
    assert "upgrade" in g.fix.lower() and "remove the == pins" in g.fix and "requirements.txt" in g.fix
    assert "gcc" not in (g.cause + g.fix).lower() and "dockerfile" not in (g.cause + g.fix).lower()
    assert g.command is None and g.source == "llm" and g.confidence == "high"
    assert line.strip()[:20] in " ".join(g.raw_tail) or g.raw_tail


@pytest.mark.parametrize("line,name,host,var", [
    ("MongoDB connection failed: connect ECONNREFUSED 127.0.0.1:27017", "MongoDB", "MongoDB Atlas", "MONGODB_URI"),
    ("pymongo.errors.ServerSelectionTimeoutError: localhost:27017: [Errno 111] Connection refused",
     "MongoDB", "MongoDB Atlas", "MONGODB_URI"),
    ('psycopg2.OperationalError: connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused',
     "PostgreSQL", "Neon or Supabase", "DATABASE_URL"),
    ("Error: connect ECONNREFUSED ::1:5432", "PostgreSQL", "Neon or Supabase", "DATABASE_URL"),
    ("Error: connect ECONNREFUSED 127.0.0.1:3306", "MySQL", "hosted MySQL", "DATABASE_URL"),
])
def test_database_on_localhost_says_use_a_hosted_database(monkeypatch, line, name, host, var):
    calls = spy_model(monkeypatch)
    g = ghost.explain("node-other", [], None, [], probe_results=["GET / -> 502", "--- app logs ---", line])
    assert calls == []
    assert name in g.cause and "localhost" in g.cause
    assert "hosted database" in g.fix or "hosted MySQL" in g.fix
    assert host in g.fix and "read its URL from an env var" in g.fix and var in g.fix
    assert "service is running" not in g.fix


def test_unrelated_failures_still_go_to_the_model(monkeypatch):
    calls = spy_model(monkeypatch)
    g = ghost.explain("react-vite", [], None, ["error during build:", "SyntaxError: Unexpected token"])
    assert calls == [1] and g.source == "fallback"


def test_a_vite_build_that_says_failed_to_build_is_not_mistaken_for_pip(monkeypatch):
    calls = spy_model(monkeypatch)
    ghost.explain("react-vite", [], None, ["Failed to build the project", "port 5432 is just a number here"])
    assert calls == [1]


def test_model_prompt_forbids_dockerfile_advice_and_knows_the_two_cases():
    p = ghost.GHOST_SYSTEM_PROMPT
    assert "never tell the student to edit a Dockerfile" in p
    assert "remove the == pins" in p and "hosted database" in p and "env var" in p


@pytest.mark.parametrize("files,paths,host", [
    ({"package.json": pkg({"express": "4", "mongoose": "8"}, {"start": "node index.js"})},
     ["package.json", "index.js"], "MongoDB Atlas"),
    ({"package.json": pkg({"express": "4", "pg": "8"}, {"start": "node server.js"})},
     ["package.json", "server.js"], "Neon or Supabase"),
    ({"requirements.txt": "fastapi\npymongo\n", "main.py": "app = FastAPI()\n"},
     ["requirements.txt", "main.py"], "MongoDB Atlas"),
    ({"requirements.txt": "flask\npsycopg2-binary\n", "app.py": "app = Flask(__name__)\n"},
     ["requirements.txt", "app.py"], "Neon or Supabase"),
])
def test_external_database_finding_names_a_hosted_service_and_the_env_var(files, paths, host):
    a, _, info = on(paths, files)
    f = next(f for f in a.findings if f.id == "db-external")
    assert f.severity == "warn" and "external database" in f.detail
    assert host in f.detail and "read its URL from an env var" in f.detail
    assert host in f.fix and "env var" in f.fix
    assert "set it up on a hosted service" not in f.detail


# ------------------------------------------------ 3, 7. name the framework, current copy

SUPPORTED = "static sites, React (Vite or Create React App), FastAPI, Flask, Django and Express apps"


def test_next_js_is_named_and_the_supported_list_is_current():
    a, _, _ = on(["package.json", "package-lock.json"], {"package.json": pkg({"next": "14", "react": "18"})})
    f = next(f for f in a.findings if f.id == "stack-node-server")
    assert f.severity == "block" and f.title == "Next.js app"
    assert "Next.js" in f.detail and SUPPORTED in f.detail
    assert "only hosts static" not in f.detail and "later version" not in (f.fix or "")
    assert "Vite" in f.fix
    assert a.verdict == "blocked" and a.summary == f.detail


def test_next_wins_over_express_in_the_name():
    a, _, _ = on(["package.json"], {"package.json": pkg({"next": "14", "express": "4"})})
    assert next(f for f in a.findings if f.id == "stack-node-server").title == "Next.js app"


@pytest.mark.parametrize("dep,name", [("@nestjs/core", "NestJS"), ("koa", "Koa")])
def test_other_unsupported_node_frameworks_are_named(dep, name):
    a, _, _ = on(["package.json"], {"package.json": pkg({dep: "1", "express": "4"})})
    f = next(f for f in a.findings if f.id == "stack-node-server")
    assert f.title == "%s app" % name and name in f.detail and "Express" in f.fix


def test_flag_off_node_server_copy_is_unchanged():
    a, _, _ = off(["package.json"], {"package.json": pkg({"next": "14"})})
    f = next(f for f in a.findings if f.id == "stack-node-server")
    assert "Resurrect only hosts static files today" in f.detail and f.fix == "Server apps arrive in a later version."


@pytest.mark.parametrize("paths,lang", [
    (["pom.xml", "src/main/java/com/x/App.java", "README.md"], "Java / Spring"),
    (["build.gradle", "src/main/java/App.java"], "Java / Spring"),
    (["go.mod", "main.go"], "Go"),
    (["Gemfile", "config.ru"], "Ruby"),
    (["composer.json", "index.php"], "PHP"),
    (["Cargo.toml", "src/main.rs"], "Rust"),
    (["App.csproj", "Program.cs"], "C# / .NET"),
])
def test_unsupported_languages_are_named_flag_on(paths, lang):
    a, _, _ = on(paths)
    f = next(f for f in a.findings if f.id == "stack-unknown")
    assert f.severity == "block" and f.title == "%s project" % lang
    assert lang in f.detail and SUPPORTED in f.detail and "not supported yet" in f.detail
    assert a.verdict == "blocked" and a.summary == f.detail


def test_unsupported_language_flag_off_lists_only_what_is_hosted_then():
    a, _, _ = off(["pom.xml", "src/main/java/App.java"])
    f = next(f for f in a.findings if f.id == "stack-unknown")
    assert f.title == "Java / Spring project" and "static sites and React apps" in f.detail
    assert "FastAPI" not in f.detail and "FastAPI" not in f.fix


def test_a_repo_that_is_nothing_in_particular_stays_unrecognised():
    for flag in (on, off):
        a, _, _ = flag(["README.md", "notes.txt"])
        assert next(f for f in a.findings if f.id == "stack-unknown").title == "Unrecognised project"


def test_blocked_verdict_drops_the_model_summary_and_its_warnings(monkeypatch):
    extra = Finding(id="llm-x", severity="warn", title="No lockfile", detail="Run pnpm install", fix=None, file=None)
    called = []
    monkeypatch.setattr(ghost, "autopsy_summary",
                        lambda *a, **k: called.append(1) or ("It should build successfully.", [extra], "rules+llm"))
    a, _, _ = on(["package.json"], {"package.json": pkg({"next": "14"})})
    assert called == []
    assert a.verdict == "blocked" and a.source == "rules" and "should build" not in a.summary
    assert not any(f.id.startswith("llm-") for f in a.findings)


def test_non_blocked_projects_still_get_the_model_review(monkeypatch):
    extra = Finding(id="llm-x", severity="warn", title="Big bundle", detail="d", fix=None, file=None)
    monkeypatch.setattr(ghost, "autopsy_summary", lambda *a, **k: ("A static page.", [extra], "rules+llm"))
    a, _, _ = on(["index.html"])
    assert a.source == "rules+llm" and "llm-x" in ids(a, "warn")


# ----------------------------------------------------------- 4. no index.html

@pytest.mark.parametrize("flag", [on, off])
def test_html_without_index_says_rename_to_index_html(flag):
    paths = ["Profileproject NEW.html", "ProfileNEW.css", "profilepic.jpg", "README.md"]
    a, _, info = flag(paths)
    f = next(f for f in a.findings if f.id == "no-index-html")
    assert f.severity == "block" and f.fix == "Rename your main page to index.html."
    assert "Profileproject NEW.html" in f.detail and f.file == "Profileproject NEW.html"
    assert a.verdict == "blocked" and a.stack == "static" and info is None
    assert "stack-unknown" not in ids(a)
    assert not autopsy.is_deployable(a)


def test_index_html_present_still_rises():
    a, _, _ = on(["index.html", "about.html"])
    assert (a.stack, a.verdict) == ("static", "healthy")


def test_html_only_in_a_subfolder_is_not_called_a_missing_index():
    a, _, _ = on(["docs/page.html", "README.md"])
    assert "no-index-html" not in ids(a)


def test_html_pages_next_to_a_package_json_are_left_to_the_normal_rules():
    a, _, _ = on(["package.json", "page.html"], {"package.json": pkg({}, {})})
    assert "no-index-html" not in ids(a)


# ------------------------------------------------- 5. Python app without requirements

FASTAPI_SRC = "from fastapi import FastAPI\napp = FastAPI()\n"
FLASK_SRC = "from flask import Flask\napp = Flask(__name__)\n"
NESTED = ["README.md", "backend/app/main.py", "backend/app/routers/auth.py", "tests/test_auth.py"]


def test_plan_fetch_reads_python_entry_files_when_there_is_no_requirements_flag_on():
    app_dir, wanted = autopsy.plan_fetch(NESTED, backends=True)
    assert wanted == ["backend/app/main.py"]
    assert autopsy.plan_fetch(NESTED, backends=False) == (".", [])         # flag off: nothing extra


def test_plan_fetch_does_not_add_entry_files_when_requirements_exist():
    _, wanted = autopsy.plan_fetch(["requirements.txt", "main.py"], backends=True)
    assert wanted == ["requirements.txt"]


def test_fastapi_without_requirements_says_so():
    a, _, info = on(NESTED, {"backend/app/main.py": FASTAPI_SRC})
    f = next(f for f in a.findings if f.id == "python-no-requirements")
    assert f.severity == "block" and a.verdict == "blocked" and info is None
    assert "FastAPI" in f.detail and "backend/app/main.py" in f.detail and "requirements.txt" in f.detail
    assert "fastapi and uvicorn" in f.fix and "requirements.txt" in f.fix
    assert "stack-unknown" not in ids(a) and a.summary == f.detail


def test_flask_without_requirements_says_so():
    a, _, _ = on(["app.py", "README.md"], {"app.py": FLASK_SRC})
    f = next(f for f in a.findings if f.id == "python-no-requirements")
    assert "Flask" in f.detail and "flask and gunicorn" in f.fix


def test_python_files_that_are_not_a_web_app_stay_unrecognised():
    a, _, _ = on(["main.py"], {"main.py": "print('hello')\n"})
    assert "python-no-requirements" not in ids(a) and "stack-unknown" in ids(a)


def test_flag_off_python_without_requirements_is_unchanged():
    a, _, _ = off(["main.py"], {"main.py": FASTAPI_SRC})
    assert "python-no-requirements" not in ids(a) and "stack-unknown" in ids(a)


def test_with_requirements_the_normal_detection_runs():
    a, _, info = on(["requirements.txt", "main.py"], {"requirements.txt": "fastapi\n", "main.py": FASTAPI_SRC})
    assert info is not None and info.framework == "fastapi" and "python-no-requirements" not in ids(a)
