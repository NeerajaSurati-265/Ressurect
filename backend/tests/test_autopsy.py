import json

import pytest

from app import autopsy, github
from app.errors import ApiException


# ---- URL parsing -----------------------------------------------------------

@pytest.mark.parametrize("url,owner,name,branch", [
    ("https://github.com/rahul/todo-of-the-dead", "rahul", "todo-of-the-dead", None),
    ("https://github.com/rahul/todo-of-the-dead.git", "rahul", "todo-of-the-dead", None),
    ("https://github.com/rahul/todo-of-the-dead/", "rahul", "todo-of-the-dead", None),
    ("https://github.com/rahul/todo/tree/dev", "rahul", "todo", "dev"),
    ("https://github.com/rahul/todo/tree/feature/x", "rahul", "todo", "feature/x"),
    ("  https://github.com/a.b/c_d.e  ", "a.b", "c_d.e", None),
    ("https://www.github.com/rahul/todo", "rahul", "todo", None),
])
def test_good_urls(url, owner, name, branch):
    p = github.parse_repo_url(url)
    assert (p.owner, p.name, p.branch) == (owner, name, branch)
    assert p.url == f"https://github.com/{owner}/{name}"


@pytest.mark.parametrize("url", [
    "", "not a url", "http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a",
    "https://github.com/a/b/issues/3", "https://github.com/a/b/blob/main/x.js", "https://github.com//b",
    "https://github.com/../b", "ftp://github.com/a/b", "https://github.com/a/b?x=1", None,
])
def test_bad_urls(url):
    with pytest.raises(ApiException) as e:
        github.parse_repo_url(url)
    assert e.value.code == "invalid_url" and e.value.status == 400


# ---- rules -----------------------------------------------------------------

def pkg(deps=None, dev=None, scripts=None, **extra):
    return json.dumps({"name": "x", "dependencies": deps or {}, "devDependencies": dev or {},
                       "scripts": scripts if scripts is not None else {"build": "x"}, **extra})


def run(paths, files=None):
    return autopsy.analyze(paths, files or {})[0]


def ids(a, severity=None):
    return {f.id for f in a.findings if severity is None or f.severity == severity}


LOCK = "package-lock.json"


def test_static():
    a = run(["index.html", "style.css"])
    assert (a.stack, a.verdict, a.app_dir) == ("static", "healthy", ".")
    assert "stack-static" in ids(a)


def test_vite():
    a = run(["package.json", "index.html", LOCK, "src/main.jsx"],
            {"package.json": pkg(dev={"vite": "^5"}, scripts={"build": "vite build"})})
    assert (a.stack, a.verdict) == ("react-vite", "healthy")
    assert "stack-vite" in ids(a)


def test_cra():
    a = run(["package.json", LOCK, "public/index.html"],
            {"package.json": pkg(deps={"react-scripts": "5"}, scripts={"build": "react-scripts build"})})
    assert (a.stack, a.verdict) == ("react-cra", "healthy")


def test_python_fastapi_blocks():
    a = run(["requirements.txt", "main.py"], {"requirements.txt": "fastapi\nuvicorn"})
    assert (a.stack, a.verdict) == ("python", "blocked")
    assert "stack-python" in ids(a, "block")
    assert not autopsy.is_deployable(a)


def test_python_manage_py():
    assert run(["manage.py", "app/settings.py"]).stack == "python"


def test_express_blocks():
    a = run(["package.json", LOCK, "server.js"],
            {"package.json": pkg(deps={"express": "4"}, scripts={"start": "node server.js"})})
    assert (a.stack, a.verdict) == ("node-other", "blocked")
    assert "stack-node-server" in ids(a, "block")


def test_next_blocks():
    a = run(["package.json", LOCK], {"package.json": pkg(deps={"next": "14", "react": "18"})})
    assert a.verdict == "blocked" and "stack-node-server" in ids(a)


def test_no_build_script_blocks():
    a = run(["package.json", LOCK, "app.js"], {"package.json": pkg(scripts={"start": "node app.js"})})
    assert a.verdict == "blocked" and "no-build-script" in ids(a, "block")


def test_cra_without_build_script_blocks():
    a = run(["package.json", LOCK], {"package.json": pkg(deps={"react-scripts": "5"}, scripts={})})
    assert "no-build-script" in ids(a, "block")


def test_vite_without_index_blocks():
    a = run(["package.json", LOCK, "src/main.jsx"],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"})})
    assert a.verdict == "blocked" and "vite-no-index" in ids(a, "block")


def test_empty_repo():
    a = run([])
    assert a.verdict == "blocked" and "empty-repo" in ids(a, "block")


def test_unknown_stack():
    a = run(["README.md", "notes.txt"])
    assert (a.stack, a.verdict) == ("unknown", "blocked") and "stack-unknown" in ids(a)


def test_unknown_bundler_with_build_script_blocks():
    a = run(["package.json", LOCK], {"package.json": pkg(deps={"svelte": "4"})})
    assert a.verdict == "blocked" and "stack-unknown" in ids(a)


def test_monorepo_uses_frontend_dir():
    paths = ["README.md", "backend/app.py", "frontend/package.json", "frontend/index.html",
             "frontend/package-lock.json"]
    assert autopsy.pick_app_dir(paths) == "frontend"
    a = run(paths, {"frontend/package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"})})
    assert (a.stack, a.app_dir, a.verdict) == ("react-vite", "frontend", "healthy")


def test_plan_fetch_caps_at_four():
    paths = ["package.json", "requirements.txt", "index.html", "vite.config.js", "vite.config.ts"]
    app_dir, wanted = autopsy.plan_fetch(paths)
    assert app_dir == "." and len(wanted) <= 4
    assert "package.json" in wanted and "vite.config.js" in wanted


def test_env_committed_warns():
    a = run(["index.html", ".env"])
    assert a.verdict == "warnings" and "env-committed" in ids(a, "warn")


def test_no_lockfile_warns():
    a = run(["package.json", "index.html"],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"})})
    assert a.verdict == "warnings" and "no-lockfile" in ids(a, "warn")


def test_lockfile_present_no_warning():
    a = run(["package.json", "index.html", "npm-shrinkwrap.json"],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"})})
    assert "no-lockfile" not in ids(a)


@pytest.mark.parametrize("spec,warn", [
    (">=22", True), ("^22.1.0", True), ("22.x", True), (">20", True), ("22", True),
    (">=18", False), ("^20", False), ("20.x", False), (">=18 <23", False), ("*", False),
    ("18 || 20", False), ("<=20", False),
])
def test_node_engine(spec, warn):
    a = run(["package.json", "index.html", LOCK],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"}, engines={"node": spec})})
    assert ("node-engine" in ids(a, "warn")) is warn


def test_vite_base_set_warns():
    a = run(["package.json", "index.html", LOCK, "vite.config.js"],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"}),
             "vite.config.js": "export default { base: '/app/' }"})
    assert "vite-base-set" in ids(a, "warn")


def test_vite_config_without_base_is_clean():
    a = run(["package.json", "index.html", LOCK, "vite.config.js"],
            {"package.json": pkg(dev={"vite": "5"}, scripts={"build": "vite build"}),
             "vite.config.js": "export default { plugins: [] }"})
    assert a.verdict == "healthy"


def test_llm_extras_can_warn_but_never_block(monkeypatch):
    from app.models import Finding

    extra = Finding(id="llm-1", severity="block", title="t", detail="d")
    monkeypatch.setattr(autopsy.ghost, "autopsy_summary",
                        lambda stack, findings, files: ("sum", [extra] * 5, "rules+llm"))
    a = run(["index.html"])
    assert a.verdict == "warnings" and a.source == "rules+llm"
    assert [f.severity for f in a.findings if f.id == "llm-1"] == ["warn"] * 3
