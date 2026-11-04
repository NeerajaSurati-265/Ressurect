"""STUB for B3: create the EventBridge one-off schedule that calls the reaper."""
from __future__ import annotations

from .models import Resurrection


def schedule(res: Resurrection) -> None:
    """Create schedule reap-<id> at expires_at. Stub: does nothing (GET still reports expiry)."""
    return None
