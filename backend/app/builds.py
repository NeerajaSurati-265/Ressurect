"""CodeBuild: start a build and read its state."""
from __future__ import annotations

from typing import Optional, TypedDict

from . import config


class BuildInfo(TypedDict):
    status: str  # IN_PROGRESS | SUCCEEDED | FAILED | FAULT | TIMED_OUT | STOPPED
    log_stream: Optional[str]


def start(res_id: str, repo_url: str, stack: str, app_dir: str, commit_sha: Optional[str]) -> str:
    s = config.settings()
    env = {"REPO_URL": repo_url, "RES_ID": res_id, "STACK": stack, "APP_DIR": app_dir,
           "BUCKET": s.bucket, "COMMIT_SHA": commit_sha or "unknown"}
    resp = config.client("codebuild").start_build(
        projectName=s.codebuild_project,
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
