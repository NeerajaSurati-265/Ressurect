"""Error ghosts and autopsy summaries: Bedrock explains, rules decide. Always falls back safely."""
from __future__ import annotations

import json
import logging
import re
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, ValidationError, field_validator

from . import bedrock
from .logs import MARKER
from .models import Finding, Ghost
from .scrub import cap_text, scrub, scrub_lines

logger = logging.getLogger(__name__)

FALLBACK_CAUSE = "The build failed before the spirits could explain why."
FALLBACK_FIX = "Read the last lines of the séance below; the first error is usually the real one."

GHOST_TIMEOUT_S = 8
SUMMARY_TIMEOUT_S = 6
LOG_LINES = 80
RAW_TAIL_LINES = 10
MAX_EXTRA_FINDINGS = 3
FORBIDDEN_COMMANDS = ("rm ", "sudo", "git push --force", "git reset --hard", "git rebase")

GHOST_SYSTEM_PROMPT = """You diagnose failed deployments of student web projects for Resurrect.
You receive the detected stack, autopsy findings, package.json and the last lines of the build log,
or HTTP check results if the build passed but the site did not respond.
Find the FIRST real error, not its consequences.
Reply with ONLY a JSON object:
{"cause": "...", "fix": "...", "command": "..." or null, "confidence": "high" | "medium" | "low"}
- cause: at most 25 words, plain English a first-year student understands; name the file or package.
- fix: at most 30 words, one concrete action.
- command: one shell command run from the repo root that applies the fix, or null if none is safe.
- Never suggest commands that delete files, rewrite git history or use sudo.
- If the log is cut off or unclear, say so and set confidence to low."""

SUMMARY_SYSTEM_PROMPT = """You review student web projects for Resurrect, a tool that deploys them for 20 minutes.
You receive the detected stack, the findings from rule-based checks and a few key files.
Reply with ONLY a JSON object:
{"summary": "...", "warnings": [{"title": "...", "detail": "...", "fix": "...", "file": "..." or null}]}
- summary: one or two plain sentences saying what this project is and whether it should build.
- warnings: at most 3 NEW problems that you can SEE in the files provided and that would break or blank the deployed site. An empty list is the normal answer.
- You only see a few files, not the whole repo. Never claim a file or dependency is missing unless the provided files prove it. Never suggest adding libraries or features.
- Never repeat a rule finding. Keep every field short and concrete."""


class _GhostReply(BaseModel):
    cause: str
    fix: str
    command: Optional[str] = None
    confidence: str

    @field_validator("cause", "fix")
    @classmethod
    def _non_empty(cls, v):
        if not isinstance(v, str) or not v.strip():
            raise ValueError("empty")
        return v.strip()

    @field_validator("confidence")
    @classmethod
    def _conf(cls, v):
        v = str(v).strip().lower()
        if v not in ("high", "medium", "low"):
            raise ValueError("bad confidence")
        return v


def _safe_command(cmd: Optional[str]) -> Optional[str]:
    if not isinstance(cmd, str) or not cmd.strip():
        return None
    low = " " + cmd.lower().strip() + " "
    if any(bad in low for bad in FORBIDDEN_COMMANDS):
        return None
    return cmd.strip()


ERROR_HINT = re.compile(
    r"(cannot find module|failed to resolve|could not resolve|module not found|error:|\berr!|"
    r"command not found|enoent|eresolve|syntax ?error|is not defined|exit status)", re.I)
MAX_HINTS = 5


ECHO_STARTS = ("Running command set -euo pipefail", "Command did not exit successfully",
               "Error while executing command")


def _visible(lines: List[str]) -> List[str]:
    """Drop markers and CodeBuild boilerplate so the real error is not pushed out of the window.

    Boilerplate is every "[Container] ..." line plus the buildspec script CodeBuild echoes back three
    times: after "Running command set -euo pipefail" (ends at the script's last line, "esac"), and after
    "Command did not exit successfully" / "Error while executing command" (ends at the next
    "[Container]" line or ". Reason:").
    """
    out: List[str] = []
    skipping = None  # None, "esac" or "container"
    for ln in lines:
        if MARKER in ln or not ln.strip():
            continue
        stripped = ln.lstrip()
        if stripped.startswith("[Container]"):
            skipping = None
            if "Running command set -euo pipefail" in ln:
                skipping = "esac"
            elif any(m in ln for m in ECHO_STARTS):
                skipping = "container"
            continue
        if skipping == "esac":
            if stripped.rstrip() == "esac":
                skipping = None
            continue
        if skipping == "container":
            if stripped.startswith(". Reason:"):
                skipping = None
            continue
        out.append(ln)
    return out


def tail_window(lines: List[str], n: int = RAW_TAIL_LINES, lookback: int = 40) -> List[str]:
    """The last n lines, slid back to start at the first error line if that is within the last
    `lookback` lines, so the tail shows the actual error and not only its stack trace."""
    if len(lines) <= n:
        return lines
    start = len(lines) - n
    for i in range(max(0, len(lines) - lookback), len(lines)):
        if ERROR_HINT.search(lines[i]):
            start = min(start, max(0, i - 1))
            break
    return lines[start:start + n]


def _hints(lines: List[str]) -> List[str]:
    """The first few lines that look like errors; the first real error is usually the cause."""
    found = [ln.strip()[:300] for ln in lines if ERROR_HINT.search(ln)]
    return found[:MAX_HINTS]


def fallback_ghost(raw_tail: List[str]) -> Ghost:
    return Ghost(cause=FALLBACK_CAUSE, fix=FALLBACK_FIX, command=None, confidence="low",
                 source="fallback", raw_tail=raw_tail)


def _findings_text(findings: List[Finding]) -> str:
    return "\n".join("- [%s] %s: %s" % (f.severity, f.id, f.title) for f in findings) or "(none)"


def explain(stack: str, findings: List[Finding], package_json: Optional[str],
            log_lines: Optional[List[str]] = None, probe_results: Optional[List[str]] = None) -> Ghost:
    """Ghost for a failed build (log_lines) or a failed pulse (probe_results)."""
    source_lines = probe_results if probe_results else (log_lines or [])
    cleaned = scrub_lines(_visible(list(source_lines)))
    lines = cleaned[-LOG_LINES:]
    raw_tail = tail_window(lines)

    label = "HTTP check results" if probe_results else "Last build log lines"
    hints = _hints(cleaned)
    hint_block = ("\n\nLines that look like errors (earliest first):\n" + "\n".join(hints)) if hints else ""
    user = "Stack: %s\n\nAutopsy findings:\n%s\n\npackage.json:\n%s%s\n\n%s:\n%s" % (
        stack, _findings_text(findings), scrub(package_json or "(none)"), hint_block, label,
        "\n".join(lines))
    user = cap_text(user)

    reply = bedrock.converse_json(GHOST_SYSTEM_PROMPT, user, max_tokens=400, timeout_s=GHOST_TIMEOUT_S)
    if reply is None:
        return fallback_ghost(raw_tail)
    try:
        parsed = _GhostReply.model_validate(reply)
    except ValidationError as exc:
        logger.warning("ghost: invalid model reply: %s", exc.errors()[:2])
        return fallback_ghost(raw_tail)
    return Ghost(cause=scrub(parsed.cause), fix=scrub(parsed.fix), command=_safe_command(parsed.command),
                 confidence=parsed.confidence, source="llm", raw_tail=raw_tail)


def _rules_summary(stack: str, findings: List[Finding]) -> str:
    blocks = [f for f in findings if f.severity == "block"]
    warns = [f for f in findings if f.severity == "warn"]
    if blocks:
        return blocks[0].detail
    if warns:
        return "This %s project should build, but %d thing%s could cause trouble." % (
            stack, len(warns), "" if len(warns) == 1 else "s")
    return "This %s project looks healthy and ready to rise." % stack


# The model sees at most four files, so "X is missing" claims about files or packages are unreliable.
ABSENCE_CLAIM = re.compile(
    r"(not (?:been )?(?:provided|included|present|found|shown|listed|available|visible)|"
    r"\bmissing\b|does not (?:appear|exist|include|contain)|doesn't (?:appear|exist|include|contain)|"
    r"key files|provided files|no (?:file|dependency|library) )", re.I)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "note"


def _clip(v, n: int) -> Optional[str]:
    return scrub(v.strip())[:n] if isinstance(v, str) and v.strip() else None


def autopsy_summary(stack: str, findings: List[Finding],
                    key_files: Optional[Dict[str, str]] = None) -> Tuple[str, List[Finding], str]:
    """(summary, up to 3 extra warn findings, source). Falls back to the rules summary."""
    rules = _rules_summary(stack, findings)
    files = "\n\n".join("--- %s ---\n%s" % (name, scrub(text)[:3000])
                        for name, text in (key_files or {}).items())
    user = cap_text("Stack: %s\n\nRule findings:\n%s\n\nKey files:\n%s" % (
        stack, _findings_text(findings), files or "(none)"))
    reply = bedrock.converse_json(SUMMARY_SYSTEM_PROMPT, user, max_tokens=500, timeout_s=SUMMARY_TIMEOUT_S)
    summary = _clip(reply.get("summary"), 300) if reply else None
    if not summary:
        return rules, [], "rules"

    taken = {f.id for f in findings}
    extras: List[Finding] = []
    raw = reply.get("warnings")
    for item in (raw if isinstance(raw, list) else []):
        if len(extras) >= MAX_EXTRA_FINDINGS:
            break
        if not isinstance(item, dict):
            continue
        title, detail = _clip(item.get("title"), 80), _clip(item.get("detail"), 240)
        if not title or not detail:
            continue
        if ABSENCE_CLAIM.search(title + " " + detail):
            continue
        fid = "llm-" + _slug(title)
        if fid in taken:
            continue
        taken.add(fid)
        extras.append(Finding(id=fid, severity="warn", title=title, detail=detail,
                              fix=_clip(item.get("fix"), 160), file=_clip(item.get("file"), 120)))
    return summary, extras, "rules+llm"
