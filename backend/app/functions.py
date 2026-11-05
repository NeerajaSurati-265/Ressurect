"""Backend apps as Lambda container functions: rz-<id> with a public Function URL.

Everything here is idempotent (a lost version race can run a step twice) and tolerant of NotFound
on cleanup, so the reaper and the failure path can both call it safely.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Dict, List, Optional

from . import config
from .models import BackendInfo

logger = logging.getLogger(__name__)

FUNCTION_PREFIX = "rz-"
MEMORY_MB = 1024
TIMEOUT_S = 30          # Django's cold start needs it; stuck calls are bounded by this and the TTL
EPHEMERAL_MB = 1024
LOG_RETENTION_DAYS = 1
APP_LOG_LINES = 50
PERMISSIONS = (
    dict(StatementId="FunctionURLAllowPublicAccess", Action="lambda:InvokeFunctionUrl",
         Principal="*", FunctionUrlAuthType="NONE"),
    dict(StatementId="FunctionURLAllowInvokeViaUrl", Action="lambda:InvokeFunction",
         Principal="*", InvokedViaFunctionUrl=True),
)


def name(res_id: str) -> str:
    return FUNCTION_PREFIX + res_id


def log_group(res_id: str) -> str:
    return "/aws/lambda/" + name(res_id)


def repo_name() -> str:
    """ECR repository name from ECR_APPS_URI (<acct>.dkr.ecr.<region>.amazonaws.com/<repo>)."""
    return config.settings().ecr_apps_uri.rsplit("/", 1)[-1] or "resurrect-apps"


def _code(exc: Exception) -> str:
    return (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", "")


def _is(exc: Exception, *codes: str) -> bool:
    return _code(exc) in codes


def cors_config(origin: str) -> dict:
    """The Function URL's own CORS setting: only the graves origin may call the API from a browser."""
    return {"AllowOrigins": [origin], "AllowMethods": ["*"], "AllowHeaders": ["*"], "AllowCredentials": False}


def create(res_id: str, info: Optional[BackendInfo] = None, cors_origin: Optional[str] = None) -> str:
    """Create the function, its public URL and permissions. Returns the function URL.

    cors_origin (full-stack only): set the URL's own Cors to allow that origin. None = no Cors, as in B4."""
    s = config.settings()
    lam, logs = config.client("lambda"), config.client("logs")
    fname = name(res_id)

    try:  # the group first, so the 1-day retention applies from the first log line
        logs.create_log_group(logGroupName=log_group(res_id))
    except Exception as exc:
        if not _is(exc, "ResourceAlreadyExistsException"):
            raise
    logs.put_retention_policy(logGroupName=log_group(res_id), retentionInDays=LOG_RETENTION_DAYS)

    try:
        lam.create_function(
            FunctionName=fname, PackageType="Image",
            Code={"ImageUri": "%s:%s" % (s.ecr_apps_uri, res_id)},
            Role=s.app_exec_role_arn, MemorySize=MEMORY_MB, Timeout=TIMEOUT_S,
            EphemeralStorage={"Size": EPHEMERAL_MB}, Architectures=["x86_64"],
            Environment={"Variables": {"PORT": "8080", "DATABASE_URL": "sqlite:////tmp/app/app.db"}},
            Tags={"resurrect-id": res_id}, Description="Resurrect backend app (temporary)")
    except Exception as exc:
        if not _is(exc, "ResourceConflictException"):
            raise  # an existing function means an earlier poll got here first: carry on

    try:
        kw = {"Cors": cors_config(cors_origin)} if cors_origin else {}
        url = lam.create_function_url_config(FunctionName=fname, AuthType="NONE", **kw)["FunctionUrl"]
    except Exception as exc:
        if not _is(exc, "ResourceConflictException"):
            raise
        url = lam.get_function_url_config(FunctionName=fname)["FunctionUrl"]

    for perm in PERMISSIONS:
        try:
            lam.add_permission(FunctionName=fname, **perm)
        except Exception as exc:
            if not _is(exc, "ResourceConflictException"):
                raise
    return url


def state(res_id: str) -> Dict[str, Optional[str]]:
    """{'state': Pending|Active|Failed|Inactive|missing, 'reason', 'code', 'update_status'}."""
    try:
        cfg = config.client("lambda").get_function(FunctionName=name(res_id))["Configuration"]
    except Exception as exc:
        if _is(exc, "ResourceNotFoundException"):
            return {"state": "missing", "reason": None, "code": None, "update_status": None}
        raise
    return {"state": cfg.get("State", "Pending"), "reason": cfg.get("StateReason"),
            "code": cfg.get("StateReasonCode"), "update_status": cfg.get("LastUpdateStatus")}


def count_live() -> int:
    """How many rz-* functions exist right now (for the MAX_LIVE_BACKENDS cap)."""
    lam = config.client("lambda")
    n, marker = 0, None
    while True:
        kw = {"Marker": marker} if marker else {}
        page = lam.list_functions(**kw)
        n += sum(1 for f in page.get("Functions", []) if f.get("FunctionName", "").startswith(FUNCTION_PREFIX))
        marker = page.get("NextMarker")
        if not marker:
            return n


def app_logs(res_id: str, lines: int = APP_LOG_LINES, since_ms: Optional[int] = None) -> List[str]:
    """Last lines of the app's own log group (boot crashes show up here). [] if there are none."""
    kw = dict(logGroupName=log_group(res_id), limit=max(200, lines * 4))
    if since_ms:
        kw["startTime"] = since_ms
    try:
        events = config.client("logs").filter_log_events(**kw).get("events", [])
    except Exception as exc:
        if _is(exc, "ResourceNotFoundException"):
            return []
        logger.warning("could not read logs of %s: %s", name(res_id), _code(exc) or type(exc).__name__)
        return []
    out: List[str] = []
    for e in events:
        for ln in (e.get("message") or "").splitlines():
            if ln.strip() and not ln.startswith(("START RequestId", "END RequestId", "REPORT RequestId")):
                out.append(ln.rstrip())
    return out[-lines:]


# What Lambda writes when the app dies while starting (gunicorn/uvicorn/node exit, bad entrypoint, import error).
_CRASH = re.compile(r"Runtime\.(?:ExitError|Unknown|InvalidEntrypoint|ImportModuleError)|INIT_REPORT[^\n]*Status: error")


def crash_line(lines: List[str]) -> Optional[str]:
    """First log line showing the app crashed on startup, or None. A crash is final: no point waiting."""
    return next((ln for ln in lines if _CRASH.search(ln)), None)


def delete(res_id: str) -> bool:
    """Delete the function (its URL goes with it). True if it existed."""
    try:
        config.client("lambda").delete_function(FunctionName=name(res_id))
        return True
    except Exception as exc:
        if _is(exc, "ResourceNotFoundException"):
            return False
        raise


def delete_image(res_id: str) -> bool:
    ecr = config.client("ecr")
    try:
        resp = ecr.batch_delete_image(repositoryName=repo_name(), imageIds=[{"imageTag": res_id}])
        return bool(resp.get("imageIds"))
    except Exception as exc:
        if _is(exc, "RepositoryNotFoundException", "ImageNotFoundException"):
            return False
        raise


def delete_log_group(res_id: str) -> bool:
    try:
        config.client("logs").delete_log_group(logGroupName=log_group(res_id))
        return True
    except Exception as exc:
        if _is(exc, "ResourceNotFoundException"):
            return False
        raise


def cleanup(res_id: str) -> Dict[str, bool]:
    """Remove the function, image and log group. Each step is independent and idempotent."""
    result = {}
    for key, fn in (("function", delete), ("image", delete_image), ("log_group", delete_log_group)):
        try:
            result[key] = fn(res_id)
        except Exception:
            logger.exception("cleanup of %s failed for %s", key, res_id)
            result[key] = False
    return result


def now_ms() -> int:
    return int(time.time() * 1000)
