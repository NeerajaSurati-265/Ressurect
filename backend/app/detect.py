"""Backend app detection (B4): FastAPI, Flask, Django, Express and Fastify.

Pure functions over the repo's file list and a few fetched files. Only used when BACKENDS_ENABLED
is true; with the flag off the autopsy never calls into this module, so behaviour is unchanged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional

from .models import BackendInfo, Finding

BACKEND_DIR_CANDIDATES = ["backend", "server", "api"]
BACKEND_MARKERS = ["package.json", "index.html", "requirements.txt", "pyproject.toml", "manage.py"]

FASTAPI_FILES = ["main.py", "app.py", "app/main.py", "src/main.py", "api/main.py"]
FLASK_FILES = ["app.py", "main.py", "wsgi.py", "app/__init__.py"]
NODE_ENTRY_FILES = ["server.js", "index.js", "app.js", "src/server.js", "src/index.js", "src/app.js"]
BLOCKING_NODE_DEPS = ["next", "@nestjs/core", "koa"]

PY_EXTERNAL_DB = ["psycopg", "psycopg2", "psycopg2-binary", "psycopg-binary", "asyncpg", "mysqlclient",
                  "pymysql", "pymongo", "motor", "mongoengine"]
NODE_EXTERNAL_DB = ["pg", "mysql2", "mysql", "mongoose", "mongodb"]
NODE_SQLITE = ["sqlite3", "better-sqlite3"]

SQLITE_DETAIL = "Gets a temporary database that resets when the app restarts."
EXTERNAL_DETAIL = ("Needs an external database; set it up on a hosted service and read its URL "
                   "from an env var.")
MAX_EXTRA_FILES = 6


@dataclass
class Detected:
    stack: str                        # "python" | "node-other"
    findings: List[Finding]
    info: Optional[BackendInfo] = None  # None means recognised but cannot run (findings block)


def _join(app_dir: str, name: str) -> str:
    return name if app_dir == "." else f"{app_dir}/{name}"


def _finding(id: str, severity: str, title: str, detail: str, fix: Optional[str] = None,
             file: Optional[str] = None) -> Finding:
    return Finding(id=id, severity=severity, title=title, detail=detail, fix=fix, file=file)


def has_dep(text: str, name: str) -> bool:
    """Is `name` listed in a requirements.txt or pyproject.toml text? Case and -/_ insensitive."""
    if not text:
        return False
    text = "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("#"))
    norm = re.sub(r"[-_.]+", "-", name.lower())
    pattern = r"(?im)(?:^|[\"'\s,\[])" + re.escape(norm).replace(r"\-", "[-_.]") + r"(?=[\s\[<>=!~;\"',\]]|$)"
    return re.search(pattern, text) is not None


def module_for(path: str) -> str:
    """app/main.py -> app.main, app/__init__.py -> app, main.py -> main."""
    mod = re.sub(r"\.py$", "", path)
    if mod.endswith("/__init__"):
        mod = mod[: -len("/__init__")]
    return mod.replace("/", ".")


def django_wsgi_project(app_dir: str, paths: List[str]) -> Optional[str]:
    prefix = "" if app_dir == "." else app_dir + "/"
    for p in sorted(paths):
        if p.startswith(prefix):
            rest = p[len(prefix):]
            parts = rest.split("/")
            if len(parts) == 2 and parts[1] == "wsgi.py" and re.fullmatch(r"[A-Za-z_]\w*", parts[0]):
                return parts[0]  # the name ends up in shell and Python source: identifiers only
    return None


def extra_files(app_dir: str, paths: List[str], files: Dict[str, str]) -> List[str]:
    """Extra files worth reading once the first batch is in (entry modules, Django settings)."""
    s = set(paths)
    want: List[str] = []

    def add(rel: str) -> None:
        p = _join(app_dir, rel)
        if p in s and p not in files and p not in want:
            want.append(p)

    pkg_text = files.get(_join(app_dir, "package.json"))
    if pkg_text:
        try:
            import json
            pkg = json.loads(pkg_text)
            main = pkg.get("main") if isinstance(pkg, dict) else None
            if isinstance(main, str):
                add(main.lstrip("./"))
        except ValueError:
            pass
        for name in NODE_ENTRY_FILES:
            add(name)
    else:
        py_text = files.get(_join(app_dir, "requirements.txt")) or files.get(_join(app_dir, "pyproject.toml")) or ""
        if has_dep(py_text, "fastapi"):
            for name in FASTAPI_FILES:
                add(name)
        if has_dep(py_text, "flask"):
            for name in FLASK_FILES:
                add(name)
        project = django_wsgi_project(app_dir, paths)
        if project and (_join(app_dir, "manage.py") in s):
            add(f"{project}/settings.py")
    return want[:MAX_EXTRA_FILES]


# ------------------------------------------------------------------ Python

def _python_db_findings(py_text: str, sources: str, file: Optional[str], django_default: bool) -> List[Finding]:
    out: List[Finding] = []
    external = [d for d in PY_EXTERNAL_DB if has_dep(py_text, d)]
    uses_sqlite = django_default or "sqlite" in sources.lower()
    if uses_sqlite:
        out.append(_finding("db-sqlite", "ok", "Temporary SQLite database", SQLITE_DETAIL, None, file))
    if external:
        out.append(_finding("db-external", "warn", "Needs an external database",
                            EXTERNAL_DETAIL + " Found: %s." % external[0],
                            "Create a free hosted database and read its URL from an env var.", file))
    return out


def _find_app_var(files: Dict[str, str], app_dir: str, candidates: List[str], ctor: str):
    pattern = re.compile(r"(?m)^(\w+)\s*=\s*" + ctor + r"\(")
    for rel in candidates:
        text = files.get(_join(app_dir, rel))
        if text:
            m = pattern.search(text)
            if m:
                return rel, m.group(1)
    return None


def _has_factory(files: Dict[str, str], app_dir: str, candidates: List[str]):
    for rel in candidates:
        text = files.get(_join(app_dir, rel))
        if text and re.search(r"(?m)^def create_app\s*\(", text):
            return rel
    return None


def detect_python(app_dir: str, paths: List[str], files: Dict[str, str]) -> Optional[Detected]:
    s = set(paths)
    req_name = next((n for n in ("requirements.txt", "pyproject.toml") if _join(app_dir, n) in s), None)
    py_text = files.get(_join(app_dir, req_name), "") if req_name else ""
    py_file = _join(app_dir, req_name) if req_name else None
    is_django = _join(app_dir, "manage.py") in s
    sources = "\n".join(t for p, t in files.items() if p.endswith(".py")) + "\n" + py_text

    if is_django:
        project = django_wsgi_project(app_dir, paths)
        if not project:
            return Detected("python", [_finding(
                "stack-django", "block", "Django project not recognised",
                "manage.py is there, but we could not find <project>/wsgi.py to start the app.",
                "Make sure your Django project folder contains wsgi.py (django-admin startproject creates it).",
                "manage.py")])
        settings_text = files.get(_join(app_dir, f"{project}/settings.py"), "")
        external_engine = re.search(r"django\.db\.backends\.(postgresql|mysql|oracle)", settings_text)
        default_sqlite = not external_engine
        findings = [_finding("stack-django", "ok", "Django project",
                             "manage.py and %s/wsgi.py are in place; it will be served with gunicorn." % project,
                             None, "manage.py")]
        findings += _python_db_findings(py_text + ("\npsycopg2" if external_engine else ""), sources, py_file,
                                        bool(default_sqlite))
        info = BackendInfo(
            framework="django", runtime="python", app_port=8000, django_project=project,
            entry="gunicorn -b 0.0.0.0:8000 %s.wsgi" % project,
            probe_paths=["/health", "/", "/admin/"], uses_sqlite=bool(default_sqlite))
        return Detected("python", findings, info)

    if has_dep(py_text, "fastapi"):
        hit = _find_app_var(files, app_dir, FASTAPI_FILES, "FastAPI")
        if not hit:
            return Detected("python", [_finding(
                "stack-fastapi", "block", "FastAPI app not found",
                "fastapi is listed, but we could not find a line like app = FastAPI() in main.py or app.py.",
                "Add `app = FastAPI()` in main.py.", py_file)])
        rel, var = hit
        findings = [_finding("stack-fastapi", "ok", "FastAPI app",
                             "Found %s in %s; it will be served with uvicorn." % (var, rel), None, rel)]
        findings += _python_db_findings(py_text, sources, py_file, False)
        info = BackendInfo(
            framework="fastapi", runtime="python", app_port=8000, live_path="/docs",
            entry="uvicorn %s:%s --host 0.0.0.0 --port 8000" % (module_for(rel), var),
            probe_paths=["/health", "/docs", "/openapi.json", "/"],
            uses_sqlite="sqlite" in sources.lower())
        return Detected("python", findings, info)

    if has_dep(py_text, "flask"):
        hit = _find_app_var(files, app_dir, FLASK_FILES, "Flask")
        factory = None if hit else _has_factory(files, app_dir, FLASK_FILES)
        if not hit and not factory:
            return Detected("python", [_finding(
                "stack-flask", "block", "Flask app not found",
                "flask is listed, but we could not find app = Flask(__name__) or a create_app() function.",
                "Add `app = Flask(__name__)` in app.py.", py_file)])
        if hit:
            rel, var = hit
            target = "%s:%s" % (module_for(rel), var)
        else:
            rel = factory
            target = '"%s:create_app()"' % module_for(rel)
        findings = [_finding("stack-flask", "ok", "Flask app",
                             "Found the app in %s; it will be served with gunicorn." % rel, None, rel)]
        findings += _python_db_findings(py_text, sources, py_file, False)
        info = BackendInfo(
            framework="flask", runtime="python", app_port=8000,
            entry="gunicorn -b 0.0.0.0:8000 %s" % target,
            probe_paths=["/health", "/", "/docs", "/openapi.json"],
            uses_sqlite="sqlite" in sources.lower())
        return Detected("python", findings, info)
    return None


# -------------------------------------------------------------------- Node

LISTEN_LITERAL = re.compile(r"listen\(\s*(\d{4,5})")
ENV_PORT = re.compile(r"process\.env\.PORT")


def detect_node(app_dir: str, paths: List[str], files: Dict[str, str], pkg: dict) -> Optional[Detected]:
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    framework = "express" if "express" in deps else "fastify" if "fastify" in deps else None
    if framework is None or any(d in deps for d in BLOCKING_NODE_DEPS):
        return None
    scripts = pkg.get("scripts") or {}
    s = set(paths)
    entry = None
    if scripts.get("start"):
        entry = "npm start"
    else:
        main = pkg.get("main")
        if isinstance(main, str) and _join(app_dir, main.lstrip("./")) in s:
            entry = "node %s" % main.lstrip("./")
        else:
            found = next((n for n in NODE_ENTRY_FILES if _join(app_dir, n) in s), None)
            if found:
                entry = "node %s" % found
    pkg_file = _join(app_dir, "package.json")
    if entry is None:
        return Detected("node-other", [_finding(
            "stack-node-server", "block", "No way to start the server",
            "package.json has no \"start\" script and we could not find server.js, index.js or app.js.",
            "Add a \"start\" script such as \"node server.js\" to package.json.", pkg_file)])

    js = "\n".join(t for p, t in files.items() if re.search(r"\.(c|m)?js$|\.ts$", p))
    literal = LISTEN_LITERAL.search(js)
    if literal:
        port = int(literal.group(1))      # the code ignores PORT, so point the adapter at its port
    elif ENV_PORT.search(js):
        port = 8080                       # the code honours PORT=8080
    else:
        port = 3000
    sources = js
    findings = [_finding("stack-" + framework, "ok", "%s server" % framework.capitalize(),
                         "Found %s in package.json; it will be started with `%s`." % (framework, entry),
                         None, pkg_file)]
    if any(d in deps for d in NODE_SQLITE):
        findings.append(_finding("db-sqlite", "ok", "Temporary SQLite database", SQLITE_DETAIL, None, pkg_file))
    ext = next((d for d in NODE_EXTERNAL_DB if d in deps), None)
    if ext:
        findings.append(_finding("db-external", "warn", "Needs an external database",
                                 EXTERNAL_DETAIL + " Found: %s." % ext,
                                 "Create a free hosted database and read its URL from an env var.", pkg_file))
    info = BackendInfo(
        framework=framework, runtime="node", entry=entry, app_port=port,
        probe_paths=["/health", "/", "/openapi.json"],
        uses_sqlite=any(d in deps for d in NODE_SQLITE) or "sqlite" in sources.lower(),
        has_build_script=bool(scripts.get("build")))
    return Detected("node-other", findings, info)


def detect(app_dir: str, paths: List[str], files: Dict[str, str], pkg: dict, has_pkg: bool) -> Optional[Detected]:
    """Backend detection. None means "not a supported backend": the normal rules decide."""
    if has_pkg:
        return detect_node(app_dir, paths, files, pkg)
    return detect_python(app_dir, paths, files)
