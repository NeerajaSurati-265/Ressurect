"""B5 Phase 2: wiring inputs of the frontend build, and the Function URL's CORS. No network, no AWS."""
import os
import subprocess
from pathlib import Path

import pytest
import yaml

from app import builds, config, functions

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "buildspec" / "static-react.yml"
BASELINE_REV = "6671272"   # static-react.yml before B5
URL = "https://abcd1234.lambda-url.us-east-1.on.aws"


def block(text: str) -> str:
    cmds = yaml.safe_load(text)["phases"]["build"]["commands"]
    assert len(cmds) == 1
    return cmds[0]


def baseline_block() -> str:
    return block(subprocess.check_output(["git", "show", "%s:buildspec/static-react.yml" % BASELINE_REV],
                                         cwd=ROOT, text=True))


STUBS = {
    "git": '#!/bin/bash\necho "git $*" >> "$LOG"\nmkdir -p src/"${APP_DIR:-.}"\n',
    "npm": '#!/bin/bash\necho "npm $*" >> "$LOG"\n'
           'if [ "$1" = run ]; then mkdir -p build; echo "VITE_API_URL=${VITE_API_URL:-} REACT_APP_API_URL=${REACT_APP_API_URL:-}" >> "$LOG"; '
           'printf "%s" "$BUILT" > build/main.js; fi\n',
    "npx": '#!/bin/bash\necho "npx $*" >> "$LOG"\nmkdir -p __resurrect_dist\n'
           'echo "VITE_API_URL=${VITE_API_URL:-} REACT_APP_API_URL=${REACT_APP_API_URL:-}" >> "$LOG"\n'
           'printf "%s" "$BUILT" > __resurrect_dist/index.js; printf "x" > __resurrect_dist/logo.png\n',
    "aws": '#!/bin/bash\necho "aws $*" >> "$LOG"\n',
}


def run(tmp_path, script: str, stack: str, **env):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    for name, body in STUBS.items():
        (bindir / name).write_text(body)
        (bindir / name).chmod(0o755)
    work = tmp_path / ("w-" + str(len(list(tmp_path.glob("w-*")))))
    work.mkdir()
    log = work / "log"
    log.write_text("")
    full = {"PATH": "%s:%s" % (bindir, os.environ["PATH"]), "LOG": str(log), "REPO_URL": "https://github.com/o/n",
            "RES_ID": "r-abc123", "STACK": stack, "BUCKET": "b", "APP_DIR": "frontend", "BUILT": "x", **env}
    (work / "block.sh").write_text(script)
    proc = subprocess.run(["bash", "block.sh"], cwd=work, env=full, capture_output=True, text=True)
    return proc, log.read_text(), work


def test_yaml_parses_and_bash_syntax_is_valid(tmp_path):
    f = tmp_path / "b.sh"
    f.write_text(block(SPEC.read_text()))
    assert subprocess.run(["bash", "-n", str(f)]).returncode == 0


@pytest.mark.parametrize("stack", ["static", "react-vite", "react-cra"])
def test_empty_inputs_run_exactly_todays_commands(tmp_path, stack):
    new = run(tmp_path, block(SPEC.read_text()), stack)
    old = run(tmp_path, baseline_block(), stack)
    assert new[0].returncode == 0 and old[0].returncode == 0, (new[0].stderr, old[0].stderr)
    assert new[1] == old[1] and new[1].strip()                       # same git/npm/npx/aws calls, same order
    assert "Wired" not in new[0].stdout and "Rewrote" not in new[0].stdout


def test_env_wiring_sets_the_names_for_the_build_only(tmp_path):
    proc, log, _ = run(tmp_path, block(SPEC.read_text()), "react-vite",
                       WIRE_URL=URL + "/", WIRE_ENV_NAMES="VITE_API_URL")
    assert proc.returncode == 0, proc.stderr
    assert "VITE_API_URL=%s " % URL in log                           # visible to the vite build, no trailing slash
    assert "Wired VITE_API_URL" in proc.stdout
    install = [ln for ln in log.splitlines() if ln.startswith("npm ci")]
    assert install                                                    # install step ran, before the export
    proc, log, _ = run(tmp_path, block(SPEC.read_text()), "react-cra",
                       WIRE_URL=URL, WIRE_ENV_NAMES="REACT_APP_API_URL,REACT_APP_BACKEND")
    assert "REACT_APP_API_URL=%s" % URL in log


BUILT = ("fetch('http://localhost:8000/notes');fetch('http://127.0.0.1:5000');fetch(\"http://localhost:8000\");"
         "a='http://localhost:3000';b='http://localhost:80001/x';c='https://example.com:8000';d='localhost:8000';"
         "e='http://localhost:8000x'")


def test_localhost_rewrite_changes_only_exact_origins_in_built_files(tmp_path):
    proc, log, work = run(tmp_path, block(SPEC.read_text()), "react-vite", BUILT=BUILT, WIRE_URL=URL,
                          REWRITE_ORIGINS="http://localhost:8000,http://127.0.0.1:5000")
    assert proc.returncode == 0, proc.stderr
    out = (work / "src" / "frontend" / "__resurrect_dist" / "index.js").read_text()
    assert out == ("fetch('%s/notes');fetch('%s');fetch(\"%s\");" % (URL, URL, URL) +
                   "a='http://localhost:3000';b='http://localhost:80001/x';c='https://example.com:8000';"
                   "d='localhost:8000';e='%sx'" % URL)               # 8000x: the origin matches, its tail stays
    assert "Rewrote the backend origin in 1 file(s)" in proc.stdout
    assert (work / "src" / "frontend" / "__resurrect_dist" / "logo.png").read_text() == "x"


def test_rewrite_never_touches_the_source(tmp_path):
    proc, log, work = run(tmp_path, block(SPEC.read_text()), "react-cra", BUILT=BUILT, WIRE_URL=URL,
                          REWRITE_ORIGINS="http://localhost:8000")
    assert proc.returncode == 0, proc.stderr
    assert (work / "src" / "frontend" / "build" / "main.js").read_text().count(URL) == 3
    # the stub clone made an empty source tree; the rewrite only ever looks inside build/
    assert [p.name for p in (work / "src" / "frontend").iterdir()] == ["build"]


@pytest.mark.parametrize("env", [
    dict(WIRE_URL="http://abcd.lambda-url.us-east-1.on.aws", WIRE_ENV_NAMES="VITE_API_URL"),
    dict(WIRE_URL="https://evil.example.com", WIRE_ENV_NAMES="VITE_API_URL"),
    dict(WIRE_URL="https://abcd.lambda-url.eu-west-1.on.aws", WIRE_ENV_NAMES="VITE_API_URL"),
    dict(WIRE_URL=URL, WIRE_ENV_NAMES="vite_api_url"),
    dict(WIRE_URL=URL, WIRE_ENV_NAMES="NEXT_PUBLIC_API_URL"),
    dict(WIRE_URL=URL, WIRE_ENV_NAMES="VITE_API_URL;rm -rf /"),
    dict(WIRE_URL=URL, REWRITE_ORIGINS="http://evil.com:80"),
    dict(WIRE_URL=URL, REWRITE_ORIGINS="http://localhost:80;id"),
    dict(WIRE_ENV_NAMES="VITE_API_URL"),                              # a name with no URL
])
def test_bad_wiring_inputs_are_rejected_before_cloning(tmp_path, env):
    proc, log, _ = run(tmp_path, block(SPEC.read_text()), "react-vite", **env)
    assert proc.returncode == 1 and ("bad WIRE" in proc.stderr or "bad REWRITE" in proc.stderr)
    assert log == ""                                                  # no git, no npm


# ---- builds.py ------------------------------------------------------------------------------------

class FakeCodeBuild:
    def __init__(self):
        self.calls = []

    def start_build(self, **kw):
        self.calls.append(kw)
        return {"build": {"id": "p:1"}}


@pytest.fixture
def cb(monkeypatch):
    fake = FakeCodeBuild()
    monkeypatch.setattr(config, "client", lambda name: fake)
    monkeypatch.setenv("BUCKET", "bkt")
    return fake


def env_of(call):
    return {e["name"]: e["value"] for e in call["environmentVariablesOverride"]}


def test_empty_wiring_gives_todays_exact_frontend_build(cb):
    builds.start("r-abc123", "https://github.com/o/n", "react-vite", "frontend", "abc")
    builds.start_frontend("r-abc123", "https://github.com/o/n", "react-vite", "frontend", "abc", URL, [], [])
    assert cb.calls[0] == cb.calls[1]


def test_start_frontend_sends_validated_wiring(cb):
    builds.start_frontend("r-abc123", "u", "react-vite", "frontend", "abc", URL + "/",
                          ["VITE_API_URL"], ["http://localhost:8000"])
    e = env_of(cb.calls[0])
    assert cb.calls[0]["projectName"] == "resurrect-build"
    assert (e["WIRE_URL"], e["WIRE_ENV_NAMES"], e["REWRITE_ORIGINS"]) == (URL, "VITE_API_URL", "http://localhost:8000")


@pytest.mark.parametrize("url,names,origins", [
    ("https://evil.com", ["VITE_X"], []), (URL, ["NEXT_PUBLIC_API"], []), (URL, ["VITE_a"], []),
    (URL, [], ["http://evil.com:80"]), ("http://abcd.lambda-url.us-east-1.on.aws", ["VITE_X"], [])])
def test_start_frontend_rejects_bad_inputs(cb, url, names, origins):
    with pytest.raises(ValueError):
        builds.start_frontend("r-abc123", "u", "react-vite", "frontend", "abc", url, names, origins)
    assert cb.calls == []


# ---- Function URL CORS ----------------------------------------------------------------------------

class FakeLogs:
    def create_log_group(self, **kw): pass
    def put_retention_policy(self, **kw): pass


class FakeLambda:
    def __init__(self):
        self.url_calls = []

    def create_function(self, **kw): return {}
    def add_permission(self, **kw): return {}

    def create_function_url_config(self, **kw):
        self.url_calls.append(kw)
        return {"FunctionUrl": URL + "/"}


@pytest.fixture
def lam(monkeypatch):
    fake = FakeLambda()
    monkeypatch.setattr(config, "client", lambda name: fake if name == "lambda" else FakeLogs())
    monkeypatch.setenv("ECR_APPS_URI", "1.dkr.ecr.us-east-1.amazonaws.com/resurrect-apps")
    return fake


def test_function_url_cors_only_when_asked(lam):
    functions.create("r-abc123")
    assert "Cors" not in lam.url_calls[0] and lam.url_calls[0]["AuthType"] == "NONE"   # B4 unchanged
    functions.create("r-abc123", cors_origin="https://d111.cloudfront.net")
    assert lam.url_calls[1]["Cors"] == {"AllowOrigins": ["https://d111.cloudfront.net"], "AllowMethods": ["*"],
                                        "AllowHeaders": ["*"], "AllowCredentials": False}
