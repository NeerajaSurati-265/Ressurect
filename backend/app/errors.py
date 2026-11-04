"""API errors that map onto the ApiError envelope in contracts/types.ts."""
from __future__ import annotations

from typing import Optional

STATUS_BY_CODE = {
    "invalid_url": 400,
    "repo_not_found": 404,
    "repo_too_large": 422,
    "rate_limited": 429,
    "quota_exhausted": 429,
    "resurrections_disabled": 503,
    "not_found": 404,
    "not_retryable": 409,
    "internal": 500,
}


class ApiException(Exception):
    def __init__(self, code: str, message: str, retry_after_s: Optional[int] = None,
                 status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after_s = retry_after_s
        self.status = status or STATUS_BY_CODE.get(code, 500)

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message,
                          "retry_after_s": self.retry_after_s}}
