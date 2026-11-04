"""STUB for B3: fallback ghost and a rules-only autopsy summary. B3 adds the Bedrock calls."""
from __future__ import annotations

from typing import List, Optional, Tuple

from .models import Autopsy, Finding, Ghost

FALLBACK_CAUSE = "The build failed before the spirits could explain why."
FALLBACK_FIX = "Read the last lines of the séance below; the first error is usually the real one."


def autopsy_summary(stack: str, findings: List[Finding], verdict: str) -> Tuple[str, List[Finding], str]:
    """Return (summary, extra_warning_findings, source). Stub: rules only, source "rules"."""
    blocks = [f for f in findings if f.severity == "block"]
    warns = [f for f in findings if f.severity == "warn"]
    if verdict == "blocked":
        summary = blocks[0].detail if blocks else "This repo cannot rise yet."
    elif verdict == "warnings":
        summary = "This %s project should build, but %d thing%s could cause trouble." % (
            stack, len(warns), "" if len(warns) == 1 else "s")
    else:
        summary = "This %s project looks healthy and ready to rise." % stack
    return summary, [], "rules"


def explain(stack: str, autopsy: Autopsy, package_json: Optional[str], log_lines: List[str],
            probe_results: Optional[List[str]] = None) -> Ghost:
    """Return a ghost for a failed build or pulse. Stub: always the fallback ghost."""
    tail = list(probe_results or log_lines)[-80:]
    return Ghost(cause=FALLBACK_CAUSE, fix=FALLBACK_FIX, command=None, confidence="low",
                 source="fallback", raw_tail=tail)
