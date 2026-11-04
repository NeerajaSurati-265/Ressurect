"""Guardrails: admin bypass, per-IP hourly limit and the daily build quota (both DynamoDB counters)."""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config
from .errors import ApiException

logger = logging.getLogger(__name__)

_admin_token: Optional[str] = None
_admin_loaded = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table():
    return config.resource("dynamodb").Table(config.settings().table_name)


def _admin_secret() -> Optional[str]:
    """Admin token from SSM, read once per cold start. Never logged."""
    global _admin_token, _admin_loaded
    if not _admin_loaded:
        try:
            resp = config.client("ssm").get_parameter(Name=config.settings().admin_token_param,
                                                      WithDecryption=True)
            _admin_token = resp["Parameter"]["Value"]
        except Exception:
            logger.exception("could not read the admin token from SSM")
            _admin_token = None
        _admin_loaded = True
    return _admin_token


def is_admin(header: Optional[str]) -> bool:
    if not header:
        return False
    secret = _admin_secret()
    if not secret:
        return False
    return hmac.compare_digest(header.encode(), secret.encode())


def _is_conditional_failure(exc: Exception) -> bool:
    return (getattr(exc, "response", None) or {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def _bump(pk: str, limit: int, ttl: int) -> bool:
    """Atomically add one to the counter at pk. False if it is already at the limit."""
    try:
        _table().update_item(
            Key={"pk": pk},
            UpdateExpression="ADD #count :one SET #ttl = :ttl",
            ConditionExpression="attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames={"#count": "count", "#ttl": "ttl"},
            ExpressionAttributeValues={":one": 1, ":ttl": ttl, ":limit": limit},
        )
        return True
    except Exception as exc:
        if _is_conditional_failure(exc):
            return False
        raise


def _next_hour(now: datetime) -> datetime:
    return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)


def _next_midnight(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)


def check(ip: Optional[str], admin_header: Optional[str]) -> None:
    """Per-IP hourly limit (POST and retry). Admin skips it."""
    if is_admin(admin_header):
        return
    now = _now()
    digest = hashlib.sha256((ip or "unknown").encode()).hexdigest()[:16]
    pk = "ip#%s#%s" % (digest, now.strftime("%Y%m%d%H"))
    if not _bump(pk, config.settings().ip_limit_per_hour, int((now + timedelta(hours=2)).timestamp())):
        retry = max(1, int((_next_hour(now) - now).total_seconds()))
        raise ApiException("rate_limited",
                           "You have used all your resurrections for this hour. Try again later.",
                           retry_after_s=retry)


def reserve_build(admin_header: Optional[str]) -> None:
    """Daily build quota. Call right before a build starts, never for cannot_rise. Admin skips it."""
    if is_admin(admin_header):
        return
    now = _now()
    pk = "quota#%s" % now.strftime("%Y-%m-%d")
    if not _bump(pk, config.settings().daily_build_quota, int((now + timedelta(days=2)).timestamp())):
        retry = max(1, int((_next_midnight(now) - now).total_seconds()))
        raise ApiException("quota_exhausted",
                           "The graveyard is full for today. Please come back tomorrow.",
                           retry_after_s=retry)
