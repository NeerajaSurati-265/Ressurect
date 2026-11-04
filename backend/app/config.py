"""Environment-driven settings and cached AWS clients. Everything runs in us-east-1."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

REGION = "us-east-1"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    table_name: str
    bucket: str
    ui_url: str
    graves_url: str
    graves_distribution_id: str
    codebuild_project: str
    log_group: str
    github_token_param: str
    admin_token_param: str
    bedrock_model_id: str
    resurrections_enabled: bool
    ip_limit_per_hour: int
    daily_build_quota: int
    lifetime_minutes: int
    reaper_arn: str
    scheduler_role_arn: str
    schedule_group: str
    backends_enabled: bool = False
    max_live_backends: int = 2
    codebuild_apps_project: str = "resurrect-build-apps"
    ecr_apps_uri: str = ""
    app_exec_role_arn: str = ""


def settings() -> Settings:
    e = os.environ.get
    return Settings(
        table_name=e("TABLE_NAME", "resurrect-records"),
        bucket=e("BUCKET", ""),
        ui_url=e("UI_URL", "").rstrip("/"),
        graves_url=e("GRAVES_URL", "").rstrip("/"),
        graves_distribution_id=e("GRAVES_DISTRIBUTION_ID", ""),
        codebuild_project=e("CODEBUILD_PROJECT", "resurrect-build"),
        log_group=e("LOG_GROUP", "/resurrect/builds"),
        github_token_param=e("GITHUB_TOKEN_PARAM", "/resurrect/github-token"),
        admin_token_param=e("ADMIN_TOKEN_PARAM", "/resurrect/admin-token"),
        bedrock_model_id=e("BEDROCK_MODEL_ID", ""),
        resurrections_enabled=e("RESURRECTIONS_ENABLED", "true").lower() == "true",
        ip_limit_per_hour=int(e("IP_LIMIT_PER_HOUR", "3")),
        daily_build_quota=int(e("DAILY_BUILD_QUOTA", "50")),
        lifetime_minutes=int(e("LIFETIME_MINUTES", "20")),
        reaper_arn=e("REAPER_ARN", ""),
        scheduler_role_arn=e("SCHEDULER_ROLE_ARN", ""),
        schedule_group=e("SCHEDULE_GROUP", "resurrect"),
        backends_enabled=e("BACKENDS_ENABLED", "false").lower() == "true",
        max_live_backends=int(e("MAX_LIVE_BACKENDS", "2")),
        codebuild_apps_project=e("CODEBUILD_APPS_PROJECT", "resurrect-build-apps"),
        ecr_apps_uri=e("ECR_APPS_URI", ""),
        app_exec_role_arn=e("APP_EXEC_ROLE_ARN", ""),
    )


@lru_cache(maxsize=None)
def client(service: str):
    import boto3

    return boto3.client(service, region_name=REGION)


@lru_cache(maxsize=None)
def resource(service: str):
    import boto3

    return boto3.resource(service, region_name=REGION)


_github_token: Optional[str] = None
_github_token_loaded = False


def github_token() -> Optional[str]:
    """Read the GitHub token from SSM once per cold start (decrypted)."""
    global _github_token, _github_token_loaded
    if _github_token_loaded:
        return _github_token
    try:
        resp = client("ssm").get_parameter(Name=settings().github_token_param, WithDecryption=True)
        _github_token = resp["Parameter"]["Value"]
    except Exception:  # unauthenticated GitHub calls still work, with a lower rate limit
        logger.exception("could not read the GitHub token from SSM")
        _github_token = None
    _github_token_loaded = True
    return _github_token
