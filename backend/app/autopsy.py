"""The autopsy: decide the stack and whether a build can succeed, using only rules.
The LLM (ghost.autopsy_summary) may add a summary and warnings but can never block."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import httpx

from . import config, detect, ghost, github
from .models import Autopsy, BackendInfo, Finding, FullstackInfo, RepoRef

APP_DIR_CANDIDATES = ["frontend", "client", "web", "app", "site"]
SERVER_DEPS = ["express", "fastify", "koa", "@nestjs/core", "next"]
LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"]
VITE_CONFIGS = ["vite.config.js", "vite.config.ts", "vite.config.mjs"]
PYTHON_MARKERS = ["requirements.txt", "pyproject.toml", "manage.py"]
MAX_EXTRA_WARNINGS = 3


def _join(app_dir: str, name: str) -> str:
    return name if app_dir == "." else f"{app_dir}/{name}"


def pick_app_dir(paths: List[str], backends: bool = False) -> str:
    s = set(paths)
    if "package.json" in s or "index.html" in s:
        return "."
    for d in APP_DIR_CANDIDATES:
        if f"{d}/package.json" in s or f"{d}/index.html" in s:
            return d
    if backends:  # appended after the existing five, so frontend/ still wins over backend/
        for d in detect.BACKEND_DIR_CANDIDATES:
            if any(f"{d}/{m}" in s for m in detect.BACKEND_MARKERS):
                return d
    return "."


def plan_fetch(paths: List[str], backends: bool = False) -> Tuple[str, List[str]]:
    """Which up-to-four files to read from raw.githubusercontent.com."""
    s = set(paths)
    app_dir = pick_app_dir(paths, backends)
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
    if backends and not wanted and not any(m in s for m in PYTHON_MARKERS):
        wanted.extend(detect.python_entry_candidates(paths))  # to say "found a FastAPI app, add requirements.txt"
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


def _html_pages(paths: List[str], app_dir: str) -> List[str]:
    """.html files directly in the app folder (there is no index.html among them when this is used)."""
    prefix = "" if app_dir == "." else app_dir + "/"
    return sorted(p for p in paths if p.lower().endswith(".html") and p.startswith(prefix)
                  and "/" not in p[len(prefix):])


UNSUPPORTED_NODE = (("next", "Next.js", "Use a Vite React app, or export your Next.js site as static files (output: 'export')."),
                    ("@nestjs/core", "NestJS", "Rewrite the server with Express, which Resurrect can host."),
                    ("koa", "Koa", "Rewrite the server with Express, which Resurrect can host."))


def _unsupported_node_server(deps: dict) -> Finding:
    """Flag on: name the framework that keeps this server app from rising, and what does rise."""
    for dep, name, fix in UNSUPPORTED_NODE:
        if dep in deps:
            return _finding("stack-node-server", "block", "%s app" % name,
                            "This is a %s app. Resurrect can host %s, but not %s yet."
                            % (name, detect.SUPPORTED_BACKENDS, name), fix, "package.json")
    return _finding("stack-node-server", "block", "Node server app",
                    "This Node server could not be started. Resurrect can host %s." % detect.SUPPORTED_BACKENDS,
                    "Add a \"start\" script such as \"node server.js\" to package.json.", "package.json")


def analyze(paths: List[str], files: Dict[str, str],
            backends: Optional[bool] = None) -> Tuple[Autopsy, Optional[str]]:
    """Pure rules over a file list and the fetched files. Returns (autopsy, package_json text)."""
    autopsy, pkg_text, _ = analyze_ex(paths, files, backends)
    return autopsy, pkg_text


def analyze_ex(paths: List[str], files: Dict[str, str], backends: Optional[bool] = None,
               fullstack: Optional[bool] = None) -> Tuple[Autopsy, Optional[str], Optional[BackendInfo]]:
    """Like analyze, plus the backend run info (only ever set when backends are enabled)."""
    autopsy, pkg_text, info, _ = analyze_full(paths, files, backends, fullstack)
    return autopsy, pkg_text, info


def analyze_full(paths: List[str], files: Dict[str, str], backends: Optional[bool] = None,
                 fullstack: Optional[bool] = None
                 ) -> Tuple[Autopsy, Optional[str], Optional[BackendInfo], Optional[FullstackInfo]]:
    """analyze_ex plus the full-stack record (B5). With the flag off this is exactly analyze_ex."""
    if backends is None:
        backends = config.settings().backends_enabled
    if fullstack is None:
        fullstack = config.settings().fullstack_enabled
    if fullstack and backends and paths:
        found = detect.detect_fullstack(paths, files)
        if found is not None:
            stack, app_dir, findings, _, pkg_text = _rules(paths, files, False, found.frontend_dir)
            wiring = detect.classify_wiring(found.frontend_dir, found.frontend_stack, paths, files)
            be = found.backend
            app_cors = bool(be.info) and detect.backend_has_cors(be.info, found.backend_dir, files)
            findings = findings + detect.fullstack_findings(found, wiring, app_cors) + be.findings
            fs = None
            if be.info is not None:
                fs = FullstackInfo(
                    frontend_dir=found.frontend_dir, backend_dir=found.backend_dir,
                    frontend_stack=found.frontend_stack, backend=be.info, wiring_kind=wiring.kind,
                    env_names=wiring.env_names, localhost_urls=wiring.localhost_urls,
                    unsupported_names=wiring.unsupported_names, app_cors=app_cors)
            return _finish(stack, app_dir, findings, files), pkg_text, (fs.backend if fs else None), fs
    stack, app_dir, findings, info, pkg_text = _rules(paths, files, backends, None)
    if not paths:
        return _finish(stack, app_dir, findings, files), None, None, None
    return _finish(stack, app_dir, findings, files), pkg_text, info, None


def _rules(paths: List[str], files: Dict[str, str], backends: bool, force_app_dir: Optional[str]
           ) -> Tuple[str, str, List[Finding], Optional[BackendInfo], Optional[str]]:
    """The rule engine: (stack, app_dir, findings, backend info, package.json text)."""
    s = set(paths)
    info: Optional[BackendInfo] = None
    findings: List[Finding] = []

    if not paths:
        findings.append(_finding("empty-repo", "block", "Nothing to resurrect",
                                 "This repo has no files on its default branch.",
                                 "Push your code to the default branch."))
        return "unknown", ".", findings, None, None

    app_dir = force_app_dir or pick_app_dir(paths, backends)
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

    be = detect.detect(app_dir, paths, files, pkg, has_pkg) if backends else None

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
    elif be is not None and not (has_pkg and ("react-scripts" in deps or "vite" in deps)):
        stack, info = be.stack, be.info
        findings.extend(be.findings)
    elif python_file and not (has_index and not has_pkg):
        stack = "python"
        findings.append(_finding("stack-python", "block", "Python project",
                                 "This is a Python project. Resurrect can only host static sites and React apps today.",
                                 "Python resurrection is coming next.", python_file))
    elif has_pkg and any(d in deps for d in SERVER_DEPS):
        stack = "node-other"
        if backends:
            findings.append(_unsupported_node_server(deps))
        else:
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
    elif not has_pkg and _html_pages(paths, app_dir):
        stack = "static"
        page = _html_pages(paths, app_dir)[0]
        findings.append(_finding("no-index-html", "block", "No index.html",
                                 "Found %s but no index.html. Browsers open index.html first, so the site would be empty." % page,
                                 "Rename your main page to index.html.", page))
    elif backends and (no_req := detect.python_without_requirements(paths, files)) is not None:
        stack = "python"
        findings.append(no_req)
    else:
        lang = detect.unsupported_language(paths)
        supported = detect.supported_text(backends)
        if lang:
            findings.append(_finding("stack-unknown", "block", "%s project" % lang,
                                     "This looks like a %s project. Resurrect can host %s; %s is not supported yet."
                                     % (lang, supported, lang),
                                     "Rebuild it as one of: %s." % supported))
        else:
            findings.append(_finding("stack-unknown", "block", "Unrecognised project",
                                     "We could not tell how to build this project.",
                                     "Static HTML and React apps can rise today." if not backends else
                                     "Resurrect can host %s." % supported))

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

    return stack, app_dir, findings, info, pkg_text


def _finish(stack: str, app_dir: str, findings: List[Finding], files: Optional[Dict[str, str]] = None) -> Autopsy:
    verdict = ("blocked" if any(f.severity == "block" for f in findings)
               else "warnings" if any(f.severity == "warn" for f in findings) else "healthy")
    if verdict == "blocked":
        # The rules already said no. A model summary ("it should build") or extra warnings would only contradict that.
        return Autopsy(verdict=verdict, stack=stack, app_dir=app_dir, summary=ghost._rules_summary(stack, findings),
                       findings=findings, source="rules")
    summary, extras, source = ghost.autopsy_summary(stack, findings, files or {})
    # The LLM may only add warnings; it can never add blocks or change the verdict.
    extra_warnings = [f.model_copy(update={"severity": "warn"}) for f in extras][:MAX_EXTRA_WARNINGS]
    findings = findings + extra_warnings
    if extra_warnings and verdict == "healthy":
        verdict = "warnings"
    return Autopsy(verdict=verdict, stack=stack, app_dir=app_dir, summary=summary,
                   findings=findings, source=source)


def is_deployable(autopsy: Autopsy, backend: Optional[BackendInfo] = None) -> bool:
    if autopsy.verdict == "blocked":
        return False
    return autopsy.stack in ("static", "react-vite", "react-cra") or backend is not None


def _fullstack_files(client, owner: str, name: str, branch: str, paths: List[str],
                     files: Dict[str, str]) -> Dict[str, str]:
    """B5 extra rounds (flag on only): candidate manifests, then the backend's entry files and the
    frontend's source files. Nothing is fetched unless the repo really has both halves."""
    got = github.fetch_raw_files(client, owner, name, branch,
                                 [p for p in detect.fullstack_fetch_plan(paths) if p not in files])
    have = {**files, **got}
    found = detect.detect_fullstack(paths, have)
    if found is None:
        return got
    more = detect.extra_files(found.backend_dir, paths, have)
    more += [p for p in detect.frontend_source_files(found.frontend_dir, paths) if p not in have]
    got.update(github.fetch_raw_files(client, owner, name, branch, [p for p in more if p not in have]))
    return got


@dataclass
class AutopsyResult:
    autopsy: Autopsy
    repo: RepoRef
    package_json: Optional[str]
    backend: Optional[BackendInfo] = None
    fullstack: Optional[FullstackInfo] = None


def run(parsed: github.ParsedUrl) -> AutopsyResult:
    """Full autopsy against GitHub. Always analyses the default branch (that's what the build clones)."""
    with httpx.Client(timeout=github.TIMEOUT, follow_redirects=True) as client:
        meta = github.fetch_repo(client, parsed.owner, parsed.name)
        # Use GitHub's canonical names from here on, in case the repo was renamed or transferred.
        owner = (meta.get("owner") or {}).get("login") or parsed.owner
        name = meta.get("name") or parsed.name
        branch = meta.get("default_branch") or "main"
        paths, sha = github.fetch_tree_and_sha(client, owner, name, branch)
        backends = config.settings().backends_enabled
        app_dir, wanted = plan_fetch(paths, backends)
        files = github.fetch_raw_files(client, owner, name, branch, wanted)
        if backends:  # entry modules and Django settings, once we know what the first files say
            more = detect.extra_files(app_dir, paths, files)
            files.update(github.fetch_raw_files(client, owner, name, branch, more))
        if backends and config.settings().fullstack_enabled:
            files.update(_fullstack_files(client, owner, name, branch, paths, files))
    autopsy, pkg_text, backend, fullstack = analyze_full(paths, files, backends)
    repo = RepoRef(owner=owner, name=name, url=f"https://github.com/{owner}/{name}",
                   default_branch=branch, commit_sha=sha)
    return AutopsyResult(autopsy=autopsy, repo=repo, package_json=(pkg_text or "")[:6000] or None, backend=backend,
                         fullstack=fullstack)
