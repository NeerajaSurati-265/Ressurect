"""DynamoDB access. Records live under pk "res#<id>" with a version for conditional writes."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config
from .models import StoredRecord

TTL_DAYS = 7


class ConflictError(Exception):
    """Another request wrote the record first."""


def _table():
    return config.resource("dynamodb").Table(config.settings().table_name)


def pk(rec_id: str) -> str:
    return f"res#{rec_id}"


def _is_conditional_failure(exc: Exception) -> bool:
    resp = getattr(exc, "response", None) or {}
    return resp.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def _item(rec: StoredRecord, version: int) -> dict:
    created = datetime.strptime(rec.res.created_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return {
        "pk": pk(rec.res.id),
        "version": version,
        "ttl": int((created + timedelta(days=TTL_DAYS)).timestamp()),
        "doc": rec.model_dump_json(),
    }


def get(rec_id: str) -> Optional[StoredRecord]:
    resp = _table().get_item(Key={"pk": pk(rec_id)})
    item = resp.get("Item")
    if not item:
        return None
    rec = StoredRecord.model_validate_json(item["doc"])
    rec.version = int(item["version"])
    return rec


def create(rec: StoredRecord) -> None:
    """Insert a new record; raises ConflictError if the id is taken."""
    rec.version = 1
    try:
        _table().put_item(
            Item=_item(rec, 1),
            ConditionExpression="attribute_not_exists(#pk)",
            ExpressionAttributeNames={"#pk": "pk"},
        )
    except Exception as exc:
        if _is_conditional_failure(exc):
            raise ConflictError(rec.res.id) from exc
        raise


def save(rec: StoredRecord) -> None:
    """Write the record if nobody changed it since we read it; bumps the version."""
    new_version = rec.version + 1
    try:
        _table().put_item(
            Item=_item(rec, new_version),
            ConditionExpression="#v = :expected",
            ExpressionAttributeNames={"#v": "version"},
            ExpressionAttributeValues={":expected": rec.version},
        )
    except Exception as exc:
        if _is_conditional_failure(exc):
            raise ConflictError(rec.res.id) from exc
        raise
    rec.version = new_version
