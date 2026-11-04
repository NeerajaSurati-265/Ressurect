import json

import pytest

from app import autopsy, config, detect


def pkg(deps=None, scripts=None, **extra):
    return json.dumps({"name": "x", "dependencies": deps or {}, "scripts": scripts or {}, **extra})


def on(paths, files):
    a, _, info = autopsy.analyze_ex(paths, files, backends=True)
    return a, info


def off(paths, files):
    return autopsy.analyze_ex(paths, files, backends=False)


def sev(a, level):
    return {f.id for f in a.findings if f.severity == level}


FASTAPI_SRC = "from fastapi import FastAPI\napp = FastAPI()\n"


# ---- FastAPI ---------------------------------------------------------------------

@pytest.mark.parametrize("root,path,module", [
    ("", "main.py", "main"),
    ("", "app/main.py", "app.main"),
    ("backend/", "main.py", "main"),
    ("", "src/main.py", "src.main"),
    ("", "api/main.py", "api.main"),
])
def test_fastapi_locations(root, path, module):
    a, info = on([root + "requirements.txt", root + path],
                 {root + "requirements.txt": "fastapi\nuvicorn\n", root + path: FASTAPI_SRC})
    assert (a.stack, a.verdict) == ("python", "healthy")
    assert a.app_dir == (root.rstrip("/") or ".")
    assert info.framework == "fastapi" and info.live_path == "/docs" and info.app_port == 8000
    assert info.entry == "uvicorn %s:app --host 0.0.0.0 --port 8000" % module
    assert "stack-fastapi" in sev(a, "ok")


def test_fastapi_custom_var_name_and_first_match_wins():
    a, info = on(["requirements.txt", "main.py", "app.py"],
                 {"requirements.txt": "fastapi==0.110\n",
                  "main.py": "api = FastAPI(title='x')\n", "app.py": "app = FastAPI()\n"})
    assert info.entry.startswith("uvicorn main:api ")


def test_fastapi_pyproject_and_extras_syntax():
    a, info = on(["pyproject.toml", "main.py"],
                 {"pyproject.toml": 'dependencies = ["fastapi[standard]>=0.100"]', "main.py": FASTAPI_SRC})
    assert info.framework == "fastapi"


def test_fastapi_without_app_object_blocks_with_precise_fix():
    a, info = on(["requirements.txt", "main.py"], {"requirements.txt": "fastapi", "main.py": "print('hi')\n"})
    assert info is None and a.verdict == "blocked"
    f = next(f for f in a.findings if f.id == "stack-fastapi")
    assert f.severity == "block" and "app = FastAPI()" in f.fix


def test_fastapi_sqlite_gets_ok_finding_postgres_gets_warn_not_block():
    src = FASTAPI_SRC + "engine = create_engine('sqlite:///./notes.db')\n"
    a, info = on(["requirements.txt", "main.py"],
                 {"requirements.txt": "fastapi\nsqlalchemy\n", "main.py": src})
    db = next(f for f in a.findings if f.id == "db-sqlite")
    assert db.severity == "ok" and db.detail == "Gets a temporary database that resets when the app restarts."
    assert info.uses_sqlite and a.verdict == "healthy"
    a, info = on(["requirements.txt", "main.py"],
                 {"requirements.txt": "fastapi\npsycopg2-binary\n", "main.py": FASTAPI_SRC})
    f = next(f for f in a.findings if f.id == "db-external")
    assert f.severity == "warn" and "external database" in f.detail
    assert a.verdict == "warnings" and info is not None


# ---- Flask -----------------------------------------------------------------------

def test_flask_plain_app():
    a, info = on(["requirements.txt", "app.py"],
                 {"requirements.txt": "Flask==3.0\n", "app.py": "app = Flask(__name__)\n"})
    assert info.framework == "flask" and info.entry == "gunicorn -b 0.0.0.0:8000 app:app"
    assert info.live_path == "" and a.stack == "python"


def test_flask_factory_pattern():
    a, info = on(["requirements.txt", "app/__init__.py"],
                 {"requirements.txt": "flask\n", "app/__init__.py": "def create_app():\n    return Flask(__name__)\n"})
    assert info.entry == 'gunicorn -b 0.0.0.0:8000 "app:create_app()"'


def test_flask_without_app_blocks():
    a, info = on(["requirements.txt", "app.py"], {"requirements.txt": "flask", "app.py": "x = 1\n"})
    assert info is None and a.verdict == "blocked"
    assert "app = Flask(__name__)" in next(f.fix for f in a.findings if f.id == "stack-flask")


# ---- Django ----------------------------------------------------------------------

def test_django_project():
    paths = ["manage.py", "requirements.txt", "mysite/settings.py", "mysite/wsgi.py", "mysite/urls.py"]
    a, info = on(paths, {"requirements.txt": "Django>=4.2\ngunicorn\n",
                         "mysite/settings.py": "DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3'}}"})
    assert (a.stack, a.verdict) == ("python", "healthy")
    assert info.framework == "django" and info.django_project == "mysite"
    assert info.entry == "gunicorn -b 0.0.0.0:8000 mysite.wsgi" and "/admin/" in info.probe_paths
    assert info.uses_sqlite and "db-sqlite" in sev(a, "ok")


def test_django_with_postgres_settings_warns():
    paths = ["manage.py", "requirements.txt", "mysite/settings.py", "mysite/wsgi.py"]
    a, info = on(paths, {"requirements.txt": "django\n",
                         "mysite/settings.py": "DATABASES={'default':{'ENGINE':'django.db.backends.postgresql'}}"})
    assert "db-external" in sev(a, "warn") and not info.uses_sqlite


def test_django_without_wsgi_blocks():
    a, info = on(["manage.py", "requirements.txt"], {"requirements.txt": "django"})
    assert info is None and a.verdict == "blocked" and "wsgi.py" in a.findings[0].fix


# ---- Express / Fastify -------------------------------------------------------------

def test_express_with_start_script():
    a, info = on(["package.json", "server.js"],
                 {"package.json": pkg({"express": "4"}, {"start": "node server.js"}),
                  "server.js": "app.listen(process.env.PORT || 3000)"})
    assert (a.stack, a.verdict) == ("node-other", "warnings")  # no lockfile warn only
    assert info.framework == "express" and info.entry == "npm start"
    assert info.app_port == 8080  # code honours PORT=8080


def test_express_hardcoded_port_5000():
    a, info = on(["package.json", "index.js"],
                 {"package.json": pkg({"express": "4"}),
                  "index.js": "const app = require('express')();\napp.listen(5000, () => {})\n"})
    assert info.entry == "node index.js" and info.app_port == 5000


def test_express_main_field_and_default_port():
    a, info = on(["package.json", "src/boot.js"],
                 {"package.json": pkg({"express": "4"}, main="src/boot.js"), "src/boot.js": "// no listen here"})
    assert info.entry == "node src/boot.js" and info.app_port == 3000


def test_fastify():
    a, info = on(["package.json", "app.js"],
                 {"package.json": pkg({"fastify": "4"}), "app.js": "fastify.listen({ port: 3000 })"})
    assert info.framework == "fastify" and info.entry == "node app.js" and info.app_port == 3000


def test_mongo_app_warns_but_is_not_blocked():
    a, info = on(["package.json", "server.js"],
                 {"package.json": pkg({"express": "4", "mongoose": "8"}, {"start": "node server.js"}),
                  "server.js": "mongoose.connect('mongodb://localhost/x')"})
    assert info is not None and "db-external" in sev(a, "warn") and a.verdict == "warnings"


def test_node_sqlite_ok_finding():
    a, info = on(["package.json", "server.js"],
                 {"package.json": pkg({"express": "4", "better-sqlite3": "9"}, {"start": "node server.js"}),
                  "server.js": ""})
    assert "db-sqlite" in sev(a, "ok") and info.uses_sqlite


def test_express_without_entry_blocks_with_precise_fix():
    a, info = on(["package.json"], {"package.json": pkg({"express": "4"})})
    assert info is None and a.verdict == "blocked"
    assert "start" in next(f.fix for f in a.findings if f.severity == "block")


@pytest.mark.parametrize("deps", [{"next": "14", "react": "18"}, {"@nestjs/core": "10", "express": "4"},
                                  {"koa": "2"}])
def test_still_blocked_stacks(deps):
    a, info = on(["package.json", "server.js"], {"package.json": pkg(deps, {"start": "node server.js"})})
    assert info is None and a.verdict == "blocked" and a.stack == "node-other"


@pytest.mark.parametrize("paths", [["go.mod", "main.go"], ["Gemfile", "app.rb"], ["pom.xml"], ["index.php"]])
def test_other_languages_stay_blocked(paths):
    a, info = on(paths, {})
    assert info is None and a.verdict == "blocked"


def test_frontend_stacks_unaffected_by_flag():
    vite = {}
    vite["package.json"] = json.dumps({"devDependencies": {"vite": "5"}, "scripts": {"build": "vite build"}})
    paths = ["package.json", "index.html", "package-lock.json"]
    assert on(paths, vite)[0].stack == "react-vite"
    assert on(["index.html"], {})[0].stack == "static"


# ---- app_dir candidates ---------------------------------------------------------------

def test_flag_on_frontend_wins_over_backend():
    paths = ["frontend/package.json", "frontend/index.html", "backend/requirements.txt", "backend/main.py"]
    files = {"frontend/package.json": json.dumps({"devDependencies": {"vite": "5"}, "scripts": {"build": "x"}}),
             "backend/requirements.txt": "fastapi", "backend/main.py": FASTAPI_SRC}
    a, info = on(paths, files)
    assert a.app_dir == "frontend" and a.stack == "react-vite" and info is None


def test_flag_on_picks_server_and_api_dirs():
    assert autopsy.pick_app_dir(["server/package.json"], backends=True) == "server"
    assert autopsy.pick_app_dir(["api/requirements.txt"], backends=True) == "api"
    assert autopsy.pick_app_dir(["backend/manage.py"], backends=True) == "backend"


def test_flag_off_server_only_repo_gives_todays_result():
    paths = ["server/package.json", "server/index.js"]
    files = {"server/package.json": pkg({"express": "4"}, {"start": "node index.js"})}
    a, pkg_text, info = off(paths, files)
    assert (a.stack, a.verdict, a.app_dir) == ("unknown", "blocked", ".")
    assert [f.id for f in a.findings] == ["stack-unknown"] and info is None
    assert autopsy.pick_app_dir(paths) == "." and autopsy.plan_fetch(paths) == (".", [])


# ---- flag off: backends stay cannot_rise exactly as before ------------------------------

@pytest.mark.parametrize("paths,files,stack,finding", [
    (["requirements.txt", "main.py"], {"requirements.txt": "fastapi", "main.py": FASTAPI_SRC}, "python", "stack-python"),
    (["requirements.txt", "app.py"], {"requirements.txt": "flask", "app.py": "app = Flask(__name__)"}, "python", "stack-python"),
    (["manage.py", "requirements.txt"], {"requirements.txt": "django"}, "python", "stack-python"),
    (["package.json", "server.js"], {"package.json": pkg({"express": "4"}, {"start": "node server.js"})},
     "node-other", "stack-node-server"),
])
def test_flag_off_backends_are_blocked_as_before(paths, files, stack, finding):
    a, _, info = off(paths, files)
    assert (a.stack, a.verdict) == (stack, "blocked") and info is None
    assert finding in {f.id for f in a.findings if f.severity == "block"}
    assert not autopsy.is_deployable(a)


def test_settings_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("BACKENDS_ENABLED", raising=False)
    assert config.settings().backends_enabled is False
    assert config.settings().max_live_backends == 2
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    assert config.settings().backends_enabled is True
    a, _ = autopsy.analyze(["requirements.txt", "main.py"], {"requirements.txt": "fastapi", "main.py": FASTAPI_SRC})
    assert a.verdict == "healthy"  # analyze() reads the flag when none is passed


# ---- extra files + helpers -------------------------------------------------------------

def test_extra_files_picks_entry_modules_and_django_settings():
    paths = ["requirements.txt", "main.py", "app/main.py", "manage.py", "mysite/wsgi.py", "mysite/settings.py"]
    got = detect.extra_files(".", paths, {"requirements.txt": "fastapi\nflask\n"})
    assert "main.py" in got and "app/main.py" in got
    assert detect.extra_files(".", paths, {"requirements.txt": "django"}) == ["mysite/settings.py"]
    assert detect.extra_files(".", ["package.json", "server.js"], {"package.json": pkg({"express": "4"})}) == ["server.js"]
    assert len(detect.extra_files(".", [f"{n}" for n in detect.NODE_ENTRY_FILES + ["package.json"]],
                                  {"package.json": "{}"})) <= detect.MAX_EXTRA_FILES


@pytest.mark.parametrize("text,name,expected", [
    ("fastapi\n", "fastapi", True), ("FastAPI==0.1", "fastapi", True), ("fastapi-utils\n", "fastapi", False),
    ("flask_cors\n", "flask", False), ("Flask>=2", "flask", True), ('"fastapi[all]"', "fastapi", True),
    ("psycopg2-binary", "psycopg2-binary", True), ("# fastapi", "fastapi", False), ("", "fastapi", False),
])
def test_has_dep(text, name, expected):
    assert detect.has_dep(text, name) is expected


def test_run_with_flag_on_fetches_entry_modules(monkeypatch):
    """autopsy.run reads the entry module in a second round so it can find app = FastAPI()."""
    from app import github

    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    paths = ["backend/requirements.txt", "backend/app/main.py"]
    monkeypatch.setattr(github, "fetch_repo", lambda c, o, n: {"owner": {"login": o}, "name": n, "default_branch": "main"})
    monkeypatch.setattr(github, "fetch_tree_and_sha", lambda c, o, n, b: (paths, "abc1234"))
    fetched = []

    def fake_raw(client, owner, name, branch, wanted):
        fetched.append(list(wanted))
        data = {"backend/requirements.txt": "fastapi\n", "backend/app/main.py": FASTAPI_SRC}
        return {p: data[p] for p in wanted if p in data}

    monkeypatch.setattr(github, "fetch_raw_files", fake_raw)
    result = autopsy.run(github.parse_repo_url("https://github.com/o/n"))
    assert result.autopsy.app_dir == "backend" and result.backend.framework == "fastapi"
    assert result.backend.entry.startswith("uvicorn app.main:app")
    assert fetched == [["backend/requirements.txt"], ["backend/app/main.py"]]


def test_django_project_name_must_be_an_identifier():
    a, info = on(["manage.py", "requirements.txt", "my;site/wsgi.py", "my;site/settings.py"], {"requirements.txt": "django"})
    assert info is None and a.verdict == "blocked"
