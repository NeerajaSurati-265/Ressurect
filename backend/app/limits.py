"""STUB for B3: per-IP rate limit and daily build quota."""
from __future__ import annotations

from typing import Optional


def check(ip: Optional[str], admin_header: Optional[str]) -> None:
    """Raise ApiException(rate_limited / quota_exhausted) when over a limit. Stub: allows everything."""
    return None
