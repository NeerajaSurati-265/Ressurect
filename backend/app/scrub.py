"""Redact secrets before text goes to an LLM or into a ghost's raw_tail."""
from __future__ import annotations

import re
from typing import List

REDACTED = "[REDACTED]"
MAX_LLM_BYTES = 12_000

_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.DOTALL),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"),
]
# key=value or key: value where the key mentions secret/token/password/apikey (api_key, api-key too).
_KV = re.compile(
    r"""(?ix)
    (?P<key>[\w.\-]*(?:secret|token|passw(?:or)?d|api[_\-]?key)[\w.\-]*)
    (?P<sep>["']?\s*[=:]\s*)
    (?P<val>"[^"\n]*"|'[^'\n]*'|[^\s,;&"']+)
    """
)


# scheme://user:password@host (database and broker URLs): keep the shape, drop the password
_URL_CREDS = re.compile(r"(\b[A-Za-z][A-Za-z0-9+.\-]*://[^\s:/@]+:)[^\s@/]+(@)")


def scrub(text: str) -> str:
    for pat in _PATTERNS:
        text = pat.sub(REDACTED, text)
    text = _URL_CREDS.sub(lambda m: m.group(1) + REDACTED + m.group(2), text)
    return _KV.sub(lambda m: m.group("key") + m.group("sep") + REDACTED, text)


def scrub_lines(lines: List[str]) -> List[str]:
    return [scrub(ln) for ln in lines]


def cap_text(text: str, max_bytes: int = MAX_LLM_BYTES) -> str:
    """Keep the END of the text (the newest log lines) within max_bytes."""
    data = text.encode("utf-8")
    if len(data) <= max_bytes:
        return text
    cut = data[-max_bytes:].decode("utf-8", errors="ignore")
    nl = cut.find("\n")
    return cut[nl + 1:] if 0 <= nl < 200 else cut
