"""CodeBuild: start a build and read its state."""
from __future__ import annotations

import re
from typing import List, Optional, TypedDict

from . import config
from .models import BackendInfo


class BuildInfo(TypedDict):
    status: str  # IN_PROGRESS | SUCCEEDED | FAILED | FAULT | TIMED_OUT | STOPPED
    log_stream: Optional[str]


def start(res_id: str, repo_url: str, stack: str, app_dir: str, commit_sha: Optional[str],
          backend: Optional[BackendInfo] = None) -> str:
    """Start a build. Static and React apps use the S3 project; backend apps use the container one."""
    s = config.settings()
    env = {"REPO_URL": repo_url, "RES_ID": res_id, "STACK": stack, "APP_DIR": app_dir,
           "BUCKET": s.bucket, "COMMIT_SHA": commit_sha or "unknown"}
    project = s.codebuild_project
    if backend is not None:
        project = s.codebuild_apps_project
        env = {"REPO_URL": repo_url, "RES_ID": res_id, "APP_DIR": app_dir, "COMMIT_SHA": commit_sha or "unknown",
               "RUNTIME": backend.runtime, "ENTRY": backend.entry, "APP_PORT": str(backend.app_port),
               "DJANGO_PROJECT": backend.django_project or "", "ECR_APPS_URI": s.ecr_apps_uri}
    resp = config.client("codebuild").start_build(
        projectName=project,
        environmentVariablesOverride=[{"name": k, "value": v, "type": "PLAINTEXT"} for k, v in env.items()],
    )
    return resp["build"]["id"]


def get(build_id: str) -> BuildInfo:
    resp = config.client("codebuild").batch_get_builds(ids=[build_id])
    builds = resp.get("builds") or []
    if not builds:
        return {"status": "FAILED", "log_stream": None}
    build = builds[0]
    return {"status": build.get("buildStatus", "IN_PROGRESS"),
            "log_stream": (build.get("logs") or {}).get("streamName")}


FUNCTION_URL_RE = re.compile(r"^https://[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws$")
WIRE_ENV_RE = re.compile(r"^(?:VITE_|REACT_APP_)[A-Z0-9_]{0,57}$")
ORIGIN_RE = re.compile(r"^http://(?:localhost|127\.0\.0\.1):\d{2,5}$")


def wiring_env(function_url: str, env_names: List[str], origins: List[str]) -> dict:
    """The optional static-react.yml inputs for a full-stack frontend. Validated here and again in the buildspec.
    Nothing to wire (no names, no origins) gives {}, which is exactly today's build."""
    if not env_names and not origins:
        return {}
    url = function_url.rstrip("/")
    if not FUNCTION_URL_RE.match(url):
        raise ValueError("not a Function URL: %r" % function_url[:80])
    if not all(WIRE_ENV_RE.match(n) and len(n) <= 64 for n in env_names):
        raise ValueError("bad env name")
    if not all(ORIGIN_RE.match(o) for o in origins):
        raise ValueError("bad origin")
    out = {"WIRE_URL": url}
    if env_names:
        out["WIRE_ENV_NAMES"] = ",".join(env_names)
    if origins:
        out["REWRITE_ORIGINS"] = ",".join(origins)
    return out


def start_frontend(res_id: str, repo_url: str, stack: str, app_dir: str, commit_sha: Optional[str],
                   function_url: str, env_names: List[str], origins: List[str]) -> str:
    """Start the normal frontend build (resurrect-build) with the backend's URL wired in."""
    s = config.settings()
    env = {"REPO_URL": repo_url, "RES_ID": res_id, "STACK": stack, "APP_DIR": app_dir,
           "BUCKET": s.bucket, "COMMIT_SHA": commit_sha or "unknown",
           **wiring_env(function_url, env_names, origins)}
    resp = config.client("codebuild").start_build(
        projectName=s.codebuild_project,
        environmentVariablesOverride=[{"name": k, "value": v, "type": "PLAINTEXT"} for k, v in env.items()],
    )
    return resp["build"]["id"]
