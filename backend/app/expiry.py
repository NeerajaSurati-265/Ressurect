"""EventBridge Scheduler one-off schedules that call the reaper when a site's time is up."""
from __future__ import annotations

import json
import logging

from . import config
from .models import Resurrection
from .timeutil import parse_iso

logger = logging.getLogger(__name__)


def schedule_name(res_id: str) -> str:
    return "reap-%s" % res_id


def _code(exc: Exception) -> str:
    return (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", "")


def schedule(res: Resurrection) -> None:
    """Create schedule reap-<id> at expires_at. Idempotent; never raises (GET-time expiry is the backstop)."""
    if res.pinned or not res.expires_at:
        return
    s = config.settings()
    when = parse_iso(res.expires_at).strftime("%Y-%m-%dT%H:%M:%S")
    try:
        config.client("scheduler").create_schedule(
            Name=schedule_name(res.id),
            GroupName=s.schedule_group,
            ScheduleExpression="at(%s)" % when,
            ScheduleExpressionTimezone="UTC",
            FlexibleTimeWindow={"Mode": "OFF"},
            Target={"Arn": s.reaper_arn, "RoleArn": s.scheduler_role_arn,
                    "Input": json.dumps({"id": res.id})},
            ActionAfterCompletion="DELETE",
        )
    except Exception as exc:
        if _code(exc) == "ConflictException":
            return
        logger.exception("could not create schedule %s", schedule_name(res.id))


def cancel(res_id: str) -> None:
    """Delete schedule reap-<id>; a missing schedule is fine."""
    try:
        config.client("scheduler").delete_schedule(Name=schedule_name(res_id),
                                                   GroupName=config.settings().schedule_group)
    except Exception as exc:
        if _code(exc) == "ResourceNotFoundException":
            return
        logger.exception("could not delete schedule %s", schedule_name(res_id))
