"""CodeBuild: start a build and read its state."""
from __future__ import annotations

from typing import Optional, TypedDict

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
