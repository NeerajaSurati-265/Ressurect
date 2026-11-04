from __future__ import annotations

from datetime import datetime, timezone

FMT = "%Y-%m-%dT%H:%M:%SZ"


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(FMT)


def parse_iso(value: str) -> datetime:
    return datetime.strptime(value, FMT).replace(tzinfo=timezone.utc)


def from_ms(ms: int) -> str:
    return iso(datetime.fromtimestamp(ms / 1000, tz=timezone.utc))
