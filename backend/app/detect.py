"""Backend app detection (B4): FastAPI, Flask, Django, Express and Fastify.

Pure functions over the repo's file list and a few fetched files. Only used when BACKENDS_ENABLED
is true; with the flag off the autopsy never calls into this module, so behaviour is unchanged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
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
# dependency -> (database, a hosted service that has a free tier). Nothing runs next to the app, so a
# localhost database can never work; the student needs a hosted one and must read its URL from an env var.
_DB_KIND = {"pymongo": "mongo", "motor": "mongo", "mongoengine": "mongo", "mongoose": "mongo", "mongodb": "mongo",
            "psycopg": "postgres", "psycopg2": "postgres", "psycopg2-binary": "postgres",
            "psycopg-binary": "postgres", "asyncpg": "postgres", "pg": "postgres",
            "mysqlclient": "mysql", "pymysql": "mysql", "mysql": "mysql", "mysql2": "mysql"}
_DB_HOSTED = {"mongo": ("MongoDB", "MongoDB Atlas"), "postgres": ("PostgreSQL", "Neon or Supabase"),
              "mysql": ("MySQL", "a hosted MySQL service")}


def external_db_finding(dep: str, file: Optional[str]) -> Finding:
    name, host = _DB_HOSTED[_DB_KIND.get(dep, "postgres")]
    return _finding("db-external", "warn", "Needs an external database",
                    "Needs an external database (%s). Use a hosted database such as %s and read its URL "
                    "from an env var. Found: %s." % (name, host, dep),
                    "Create a free hosted database such as %s and read its URL from an env var." % host, file)


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
        out.append(external_db_finding(external[0], file))
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
        findings.append(external_db_finding(ext, pkg_file))
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


# ------------------------------------------- Python with no requirements.txt, and unsupported languages

PY_ENTRY_CANDIDATES = FASTAPI_FILES + [f for f in FLASK_FILES if f not in FASTAPI_FILES] + [
    "backend/main.py", "backend/app.py", "backend/app/main.py", "server/main.py", "server/app.py"]
_PY_FRAMEWORKS = (("FastAPI", re.compile(r"\bFastAPI\s*\(|^\s*(?:from|import)\s+fastapi\b", re.M)),
                  ("Flask", re.compile(r"\bFlask\s*\(|^\s*(?:from|import)\s+flask\b", re.M)))


def python_entry_candidates(paths: List[str]) -> List[str]:
    s = set(paths)
    return [p for p in PY_ENTRY_CANDIDATES if p in s]


def python_without_requirements(paths: List[str], files: Dict[str, str]) -> Optional[Finding]:
    """A FastAPI or Flask app whose repo has no requirements.txt or pyproject.toml (so pip has nothing to read)."""
    for rel in python_entry_candidates(paths):
        text = files.get(rel)
        if not text:
            continue
        for name, pattern in _PY_FRAMEWORKS:
            if pattern.search(text):
                return _finding(
                    "python-no-requirements", "block", "No requirements.txt",
                    "Found a %s app in %s, but the repo has no requirements.txt, so we do not know "
                    "which packages to install." % (name, rel),
                    "Add a requirements.txt listing %s and your other packages (run `pip freeze > requirements.txt`)."
                    % ("fastapi and uvicorn" if name == "FastAPI" else "flask and gunicorn"), rel)
    return None


SUPPORTED_BACKENDS = "static sites, React (Vite or Create React App), FastAPI, Flask, Django and Express apps"
SUPPORTED_FRONTENDS = "static sites and React apps"
# first matching file name decides the language (checked at the repo root or one folder down)
_LANG_FILES = (("Java / Spring", ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle")),
               ("Go", ("go.mod",)), ("Ruby", ("Gemfile",)), ("PHP", ("composer.json",)),
               ("Rust", ("Cargo.toml",)), ("C# / .NET", ("global.json",)), ("Dart / Flutter", ("pubspec.yaml",)),
               ("Elixir", ("mix.exs",)))
_LANG_SUFFIX = ((".csproj", "C# / .NET"), (".sln", "C# / .NET"), (".java", "Java / Spring"), (".go", "Go"),
                (".rb", "Ruby"), (".php", "PHP"), (".rs", "Rust"))


def unsupported_language(paths: List[str]) -> Optional[str]:
    near = [p for p in paths if p.count("/") <= 1]
    names = {p.rsplit("/", 1)[-1] for p in near}
    for lang, files in _LANG_FILES:
        if any(f in names for f in files):
            return lang
    for suffix, lang in _LANG_SUFFIX:
        if any(p.endswith(suffix) for p in paths):
            return lang
    return None


def supported_text(backends: bool) -> str:
    return SUPPORTED_BACKENDS if backends else SUPPORTED_FRONTENDS


# ================================================================ B5: full-stack (frontend + backend)

FRONTEND_DIRS = [".", "frontend", "client", "web", "app", "site"]
FULLSTACK_BACKEND_DIRS = [".", "backend", "server", "api"]
VITE_CONFIGS = ["vite.config.js", "vite.config.ts", "vite.config.mjs"]
MAX_SOURCE_FILES = 16
MAX_ENV_FILES = 3
SOURCE_EXT = (".js", ".jsx", ".ts", ".tsx")
ENV_FILE_NAMES = (".env.example", ".env.production", ".env.sample")
API_WORD = re.compile(r"API|BACKEND|SERVER|BASE_URL")
VITE_BUILTIN = {"BASE_URL", "MODE", "PROD", "DEV", "SSR"}
ENV_NAME_RE = r"^[A-Z][A-Z0-9_]{0,63}$"

_ENV_ACCESS = re.compile(r"(?:import\.meta\.env|process\.env)\.([A-Za-z_][A-Za-z0-9_]*)")
_ENV_BRACKET = re.compile(r"""(?:import\.meta\.env|process\.env)\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]""")
_ENV_LINE = re.compile(r"(?m)^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
_LOCALHOST = re.compile(r"https?://(?:localhost|127\.0\.0\.1):\d{2,5}(?![\d])")
_RELATIVE_CALL = re.compile(r"""(?:fetch|axios(?:\.\w+)?|\$http\.\w+|api\.\w+)\(\s*[`"']/(?!/)""")
_PROXY_KEY = re.compile(r"\bproxy\s*:")

_CORS_PY = ("flask_cors", "flask-cors", "django-cors-headers", "corsheaders")
_CORS_SRC = re.compile(r"CORSMiddleware|flask_cors|corsheaders|require\(\s*['\"]cors['\"]\s*\)|"
                       r"from\s+['\"]cors['\"]|@fastify/cors|fastify-cors|\bCORS\(")


def _loads(text: Optional[str]) -> dict:
    import json
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def frontend_stack_of(app_dir: str, paths: List[str], files: Dict[str, str]) -> Optional[str]:
    """react-vite or react-cra if this folder holds a deployable React frontend, else None."""
    s = set(paths)
    pkg_path = _join(app_dir, "package.json")
    if pkg_path not in s:
        return None
    pkg = _loads(files.get(pkg_path))
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    if "react-scripts" in deps:
        return "react-cra"
    if "vite" in deps and _join(app_dir, "index.html") in s:
        return "react-vite"
    return None


def fullstack_fetch_plan(paths: List[str]) -> List[str]:
    """Round one: the small manifest files of every candidate folder (the tree tells us what exists)."""
    s = set(paths)
    want: List[str] = []
    for d in FRONTEND_DIRS + [d for d in FULLSTACK_BACKEND_DIRS if d not in FRONTEND_DIRS]:
        for name in ["package.json", "requirements.txt", "pyproject.toml"] + VITE_CONFIGS:
            p = _join(d, name)
            if p in s and p not in want:
                want.append(p)
    return want[:24]


def frontend_source_files(frontend_dir: str, paths: List[str]) -> List[str]:
    """Round two: a capped set of the frontend's source and env files, shallow files first."""
    prefix = "" if frontend_dir == "." else frontend_dir + "/"
    src = sorted((p for p in paths if p.startswith(prefix + "src/") and p.endswith(SOURCE_EXT)
                  and not re.search(r"\.(test|spec|stories)\.|\.d\.ts$", p)),
                 key=lambda p: (p.count("/"), p))[:MAX_SOURCE_FILES]
    env = [prefix + n for n in ENV_FILE_NAMES if prefix + n in paths][:MAX_ENV_FILES]
    return src + env


@dataclass
class Wiring:
    kind: str                                   # env | localhost | proxy | unsupported | none
    env_names: List[str] = field(default_factory=list)
    localhost_urls: List[str] = field(default_factory=list)
    unsupported_names: List[str] = field(default_factory=list)


def classify_wiring(frontend_dir: str, frontend_stack: str, paths: List[str], files: Dict[str, str]) -> Wiring:
    """How does this frontend find its API? Only VITE_* (Vite) and REACT_APP_* (CRA) can be set at build time."""
    prefix = "" if frontend_dir == "." else frontend_dir + "/"
    own = {p: t for p, t in files.items() if p.startswith(prefix)}
    # the app's own code only: vite.config.js ends in .js too, and its proxy target is not an API call
    src_text = "\n".join(t for p, t in own.items() if p.startswith(prefix + "src/") and p.endswith(SOURCE_EXT))
    wanted_prefix = "VITE_" if frontend_stack == "react-vite" else "REACT_APP_"

    seen = set(_ENV_ACCESS.findall(src_text)) | set(_ENV_BRACKET.findall(src_text))
    for p, t in own.items():
        if p.rsplit("/", 1)[-1] in ENV_FILE_NAMES:
            seen |= set(_ENV_LINE.findall(t))
    api_names = sorted(n for n in seen if API_WORD.search(n) and n not in VITE_BUILTIN)
    env_names = [n for n in api_names if n.startswith(wanted_prefix) and re.match(ENV_NAME_RE, n)]
    unsupported = [n for n in api_names if n not in env_names]
    localhost = sorted(set(_LOCALHOST.findall(src_text)))

    if env_names:
        return Wiring("env", env_names, localhost, unsupported)
    if localhost:
        return Wiring("localhost", [], localhost, unsupported)
    cfg = "\n".join(own.get(_join(frontend_dir, c), "") for c in VITE_CONFIGS)
    pkg_proxy = isinstance(_loads(own.get(_join(frontend_dir, "package.json"))).get("proxy"), str)
    if (_PROXY_KEY.search(cfg) or pkg_proxy) and _RELATIVE_CALL.search(src_text):
        return Wiring("proxy", [], [], unsupported)
    if unsupported:
        return Wiring("unsupported", [], [], unsupported)
    return Wiring("none")


def backend_has_cors(info: BackendInfo, backend_dir: str, files: Dict[str, str]) -> bool:
    prefix = "" if backend_dir == "." else backend_dir + "/"
    text = "\n".join(t for p, t in files.items() if p.startswith(prefix))
    if info.runtime == "python":
        reqs = "\n".join(t for p, t in files.items() if p.startswith(prefix) and
                         p.rsplit("/", 1)[-1] in ("requirements.txt", "pyproject.toml"))
        if any(has_dep(reqs, d) for d in _CORS_PY):
            return True
    return _CORS_SRC.search(text) is not None


@dataclass
class FullstackDetected:
    frontend_dir: str
    frontend_stack: str
    backend_dir: str
    backend: Detected                  # .info is None when the backend is recognised but cannot run


def detect_fullstack(paths: List[str], files: Dict[str, str]) -> Optional[FullstackDetected]:
    """A deployable React frontend and a supported backend in two different folders, else None."""
    fe = next(((d, st) for d in FRONTEND_DIRS if (st := frontend_stack_of(d, paths, files))), None)
    if fe is None:
        return None
    for d in FULLSTACK_BACKEND_DIRS:
        if d == fe[0]:
            continue
        pkg_text = files.get(_join(d, "package.json"))
        has_pkg = _join(d, "package.json") in set(paths)
        if has_pkg and frontend_stack_of(d, paths, files):
            continue  # that folder is itself a React app
        hit = detect(d, paths, files, _loads(pkg_text), has_pkg)
        if hit is not None:
            return FullstackDetected(fe[0], fe[1], d, hit)
    return None


def fullstack_findings(fs: FullstackDetected, wiring: Wiring, app_cors: bool) -> List[Finding]:
    fe_name = "Vite" if fs.frontend_stack == "react-vite" else "Create React App"
    be_name = fs.backend.info.framework.capitalize() if fs.backend.info else "backend"
    if fs.backend.info is None:
        # The backend half is what blocks; say so, so nobody goes hunting in a frontend that is fine.
        blockers = [f for f in fs.backend.findings if f.severity == "block"]
        out = [_finding("fullstack-backend-blocked", "block", "The backend is what blocks this repo",
                        "The frontend in %s looked fine (React with %s). The backend in %s is the blocker: %s"
                        % (fs.frontend_dir, fe_name, fs.backend_dir,
                           blockers[0].detail if blockers else "it could not be started."),
                        blockers[0].fix if blockers else None, blockers[0].file if blockers else None)]
        return out
    out = [_finding("fullstack-detected", "ok", "Full-stack app",
                    "React (%s) frontend in %s and %s backend in %s. The backend rises first, then the "
                    "frontend is built pointed at it." % (fe_name, fs.frontend_dir, be_name, fs.backend_dir),
                    None, None)]
    if wiring.kind == "env":
        out.append(_finding("fullstack-wiring", "ok", "Frontend reads its API address from env",
                            "The frontend reads %s; we set it to the backend's address when we build."
                            % ", ".join(wiring.env_names), None, None))
    elif wiring.kind == "localhost":
        out.append(_finding("fullstack-wiring", "ok", "Frontend calls localhost",
                            "The frontend calls %s; in the built files we replace that with the backend's live "
                            "address." % ", ".join(wiring.localhost_urls), None, None))
    elif wiring.kind == "proxy":
        var = "VITE_API_URL" if fs.frontend_stack == "react-vite" else "REACT_APP_API_URL"
        out.append(_finding("fullstack-wiring", "warn", "Frontend relies on a dev proxy",
                            "The frontend calls relative paths like /api and relies on the dev server's proxy, "
                            "which does not exist on the live site, so its API calls will fail.",
                            "Read the API URL from %s instead of the dev proxy." % var, None))
    elif wiring.kind == "unsupported":
        out.append(_finding("fullstack-wiring", "warn", "API address variable we cannot set",
                            "The frontend reads %s, but only %s variables reach a %s build, so we cannot wire the "
                            "API address and cannot verify the wiring. The frontend's API calls may not reach the "
                            "server." % (", ".join(wiring.unsupported_names),
                                         "VITE_*" if fs.frontend_stack == "react-vite" else "REACT_APP_*", fe_name),
                            "Rename it to %s_API_URL." % ("VITE" if fs.frontend_stack == "react-vite" else "REACT_APP"),
                            None))
    else:
        out.append(_finding("fullstack-wiring", "warn", "No API address found in the frontend",
                            "We could not find where the frontend reads its API address, so it may not reach the "
                            "backend.", "Read the API URL from %s." % (
                                "VITE_API_URL" if fs.frontend_stack == "react-vite" else "REACT_APP_API_URL"), None))
    if app_cors:
        out.append(_finding("backend-cors", "ok", "Backend sets its own CORS",
                            "The backend configures CORS itself, so we leave its headers alone.", None, None))
    return out
