"""The autopsy: decide the stack and whether a build can succeed, using only rules.
The LLM (ghost.autopsy_summary) may add a summary and warnings but can never block."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import httpx

from . import ghost, github
from .models import Autopsy, Finding, RepoRef

APP_DIR_CANDIDATES = ["frontend", "client", "web", "app", "site"]
SERVER_DEPS = ["express", "fastify", "koa", "@nestjs/core", "next"]
LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"]
VITE_CONFIGS = ["vite.config.js", "vite.config.ts", "vite.config.mjs"]
PYTHON_MARKERS = ["requirements.txt", "pyproject.toml", "manage.py"]
MAX_EXTRA_WARNINGS = 3


def _join(app_dir: str, name: str) -> str:
    return name if app_dir == "." else f"{app_dir}/{name}"


def pick_app_dir(paths: List[str]) -> str:
    s = set(paths)
    if "package.json" in s or "index.html" in s:
        return "."
    for d in APP_DIR_CANDIDATES:
        if f"{d}/package.json" in s or f"{d}/index.html" in s:
            return d
    return "."


def plan_fetch(paths: List[str]) -> Tuple[str, List[str]]:
    """Which up-to-four files to read from raw.githubusercontent.com."""
    s = set(paths)
    app_dir = pick_app_dir(paths)
    wanted: List[str] = []
    for name in ["package.json"]:
        if _join(app_dir, name) in s:
            wanted.append(_join(app_dir, name))
    for candidate in [_join(app_dir, "requirements.txt"), _join(app_dir, "pyproject.toml"),
                      "requirements.txt", "pyproject.toml"]:
        if candidate in s and candidate not in wanted:
            wanted.append(candidate)
            break
    if _join(app_dir, "index.html") in s:
        wanted.append(_join(app_dir, "index.html"))
    for cfg in VITE_CONFIGS:
        if _join(app_dir, cfg) in s:
            wanted.append(_join(app_dir, cfg))
            break
    return app_dir, wanted[:4]


def _finding(id: str, severity: str, title: str, detail: str, fix: Optional[str] = None,
             file: Optional[str] = None) -> Finding:
    return Finding(id=id, severity=severity, title=title, detail=detail, fix=fix, file=file)


def _engine_requires_above_20(spec: str) -> bool:
    """True if every alternative in an npm engines.node range needs Node 21 or newer."""
    alternatives = [a for a in re.split(r"\|\|", spec) if a.strip()]
    if not alternatives:
        return False
    for alt in alternatives:
        lower = 0
        for op, version in re.findall(r"(>=|>|\^|~|=|<=|<)?\s*v?(\d+(?:\.\d+)*|\*)", alt):
            if op in ("<", "<=") or version == "*":
                continue
            parts = version.split(".")
            major = int(parts[0])
            if op == ">" and len(parts) == 1:
                major += 1
            lower = max(lower, major)
        if lower <= 20:
            return False
    return True


def analyze(paths: List[str], files: Dict[str, str]) -> Tuple[Autopsy, Optional[str]]:
    """Pure rules over a file list and the fetched files. Returns (autopsy, package_json text)."""
    s = set(paths)
    findings: List[Finding] = []

    if not paths:
        findings.append(_finding("empty-repo", "block", "Nothing to resurrect",
                                 "This repo has no files on its default branch.",
                                 "Push your code to the default branch."))
        return _finish("unknown", ".", findings), None

    app_dir = pick_app_dir(paths)
    pkg_path = _join(app_dir, "package.json")
    has_pkg = pkg_path in s
    has_index = _join(app_dir, "index.html") in s
    pkg_text = files.get(pkg_path)
    pkg: dict = {}
    if pkg_text:
        try:
            parsed = json.loads(pkg_text)
            pkg = parsed if isinstance(parsed, dict) else {}
        except ValueError:
            pkg = {}
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    has_build = bool((pkg.get("scripts") or {}).get("build"))
    python_file = next((m for m in PYTHON_MARKERS
                        if _join(app_dir, m) in s or m in s), None)

    stack = "unknown"
    if has_pkg and "react-scripts" in deps:
        stack = "react-cra"
        if has_build:
            findings.append(_finding("stack-cra", "ok", "React app (Create React App)",
                                     "package.json uses react-scripts and has a build script.", None, "package.json"))
        else:
            findings.append(_finding("no-build-script", "block", "No build script",
                                     "package.json has no \"build\" script, so there is nothing to build.",
                                     "Add \"build\": \"react-scripts build\" to scripts.", "package.json"))
    elif has_pkg and "vite" in deps:
        stack = "react-vite"
        if not has_index:
            findings.append(_finding("vite-no-index", "block", "No index.html next to package.json",
                                     "Vite builds from an index.html in the app folder, and there isn't one.",
                                     "Vite needs index.html next to package.json.", "index.html"))
        else:
            findings.append(_finding("stack-vite", "ok", "React app built with Vite",
                                     "package.json depends on vite and index.html is in place.", None, "package.json"))
    elif python_file and not (has_index and not has_pkg):
        stack = "python"
        findings.append(_finding("stack-python", "block", "Python project",
                                 "This is a Python project. Resurrect can only host static sites and React apps today.",
                                 "Python resurrection is coming next.", python_file))
    elif has_pkg and any(d in deps for d in SERVER_DEPS):
        stack = "node-other"
        server = next(d for d in SERVER_DEPS if d in deps)
        findings.append(_finding("stack-node-server", "block", "Node server app",
                                 "This project needs a running server (%s). Resurrect only hosts static files today." % server,
                                 "Server apps arrive in a later version.", "package.json"))
    elif has_pkg and not has_build and not has_index:
        stack = "node-other"
        findings.append(_finding("no-build-script", "block", "No build script",
                                 "package.json has no \"build\" script and there is no index.html to host as-is.",
                                 "Add \"build\": \"vite build\" to scripts.", "package.json"))
    elif has_index and (not has_pkg or not has_build):
        stack = "static"
        findings.append(_finding("stack-static", "ok", "Static website",
                                 "index.html is in place and nothing needs building.", None, "index.html"))
    else:
        findings.append(_finding("stack-unknown", "block", "Unrecognised project",
                                 "We could not tell how to build this project.",
                                 "Static HTML and React apps can rise today."))

    # Warnings
    if has_pkg:
        if not any(_join(app_dir, lock) in s for lock in LOCKFILES):
            findings.append(_finding("no-lockfile", "warn", "No lockfile",
                                     "Without package-lock.json, npm may install newer versions than you tested.",
                                     "Run npm install and commit package-lock.json.", None))
        engines = (pkg.get("engines") or {}).get("node") if isinstance(pkg.get("engines"), dict) else None
        if isinstance(engines, str) and _engine_requires_above_20(engines):
            findings.append(_finding("node-engine", "warn", "Newer Node version requested",
                                     "package.json asks for Node %s, but we build on Node 20." % engines,
                                     "We build on Node 20.", "package.json"))
    env_files = [p for p in paths if p.rsplit("/", 1)[-1] in (".env", ".env.local")]
    if env_files:
        findings.append(_finding("env-committed", "warn", "Environment file in the repo",
                                 "%s is committed, and it may contain secrets." % env_files[0],
                                 "Delete it, add it to .gitignore and rotate any keys inside.", env_files[0]))
    for cfg in VITE_CONFIGS:
        text = files.get(_join(app_dir, cfg))
        if text and re.search(r"\bbase\s*:", text):
            findings.append(_finding("vite-base-set", "warn", "Vite base path is set",
                                     "%s sets \"base\"; we override it during the build." % cfg,
                                     "We override it during the build; check your asset paths.", cfg))
            break

    return _finish(stack, app_dir, findings), pkg_text


def _finish(stack: str, app_dir: str, findings: List[Finding]) -> Autopsy:
    verdict = ("blocked" if any(f.severity == "block" for f in findings)
               else "warnings" if any(f.severity == "warn" for f in findings) else "healthy")
    summary, extras, source = ghost.autopsy_summary(stack, findings, verdict)
    # The LLM may only add warnings; it can never add blocks or change the verdict.
    extra_warnings = [f.model_copy(update={"severity": "warn"}) for f in extras][:MAX_EXTRA_WARNINGS]
    findings = findings + extra_warnings
    if extra_warnings and verdict == "healthy":
        verdict = "warnings"
    return Autopsy(verdict=verdict, stack=stack, app_dir=app_dir, summary=summary,
                   findings=findings, source=source)


def is_deployable(autopsy: Autopsy) -> bool:
    return autopsy.verdict != "blocked" and autopsy.stack in ("static", "react-vite", "react-cra")


@dataclass
class AutopsyResult:
    autopsy: Autopsy
    repo: RepoRef
    package_json: Optional[str]


def run(parsed: github.ParsedUrl) -> AutopsyResult:
    """Full autopsy against GitHub. Always analyses the default branch (that's what the build clones)."""
    with httpx.Client(timeout=github.TIMEOUT, follow_redirects=True) as client:
        meta = github.fetch_repo(client, parsed.owner, parsed.name)
        # Use GitHub's canonical names from here on, in case the repo was renamed or transferred.
        owner = (meta.get("owner") or {}).get("login") or parsed.owner
        name = meta.get("name") or parsed.name
        branch = meta.get("default_branch") or "main"
        paths, sha = github.fetch_tree_and_sha(client, owner, name, branch)
        _, wanted = plan_fetch(paths)
        files = github.fetch_raw_files(client, owner, name, branch, wanted)
    autopsy, pkg_text = analyze(paths, files)
    repo = RepoRef(owner=owner, name=name, url=f"https://github.com/{owner}/{name}",
                   default_branch=branch, commit_sha=sha)
    return AutopsyResult(autopsy=autopsy, repo=repo, package_json=(pkg_text or "")[:6000] or None)
