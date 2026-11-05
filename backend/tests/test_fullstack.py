"""B5 full-stack: detection (Phase 1). Pure rules over file lists; no network, no AWS."""
import json

import pytest

from app import autopsy, config, detect, github


def pkg(deps=None, scripts=None, **extra):
    return json.dumps({"name": "x", "dependencies": deps or {}, "scripts": scripts or {"build": "x"}, **extra})


VITE_PKG = pkg({"react": "18", "vite": "5"})
CRA_PKG = pkg({"react": "18", "react-scripts": "5"})
FASTAPI = {"backend/requirements.txt": "fastapi\nuvicorn\n", "backend/main.py": "app = FastAPI()\n"}
FASTAPI_PATHS = list(FASTAPI)
VITE_PATHS = ["frontend/package.json", "frontend/index.html", "frontend/package-lock.json", "frontend/src/App.jsx"]


def full(paths, files, fullstack=True):
    return autopsy.analyze_full(paths, files, backends=True, fullstack=fullstack)


def ids(a, sev):
    return {f.id for f in a.findings if f.severity == sev}


def vite_fastapi(src, extra_files=None, extra_paths=()):
    files = {"frontend/package.json": VITE_PKG, "frontend/src/App.jsx": src, **FASTAPI, **(extra_files or {})}
    return VITE_PATHS + FASTAPI_PATHS + list(extra_paths), files


def test_vite_plus_fastapi_with_vite_api_url():
    paths, files = vite_fastapi("const u = import.meta.env.VITE_API_URL;")
    a, _, info, fs = full(paths, files)
    assert (a.stack, a.app_dir, a.verdict) == ("react-vite", "frontend", "healthy")
    assert info is fs.backend and info.framework == "fastapi"
    assert (fs.frontend_dir, fs.backend_dir, fs.wiring_kind) == ("frontend", "backend", "env")
    assert fs.env_names == ["VITE_API_URL"]
    assert {"fullstack-detected", "fullstack-wiring", "stack-vite", "stack-fastapi"} <= ids(a, "ok")


def test_cra_plus_express_with_react_app_api_url():
    paths = ["client/package.json", "client/package-lock.json", "client/src/index.js",
             "server/package.json", "server/index.js"]
    files = {"client/package.json": CRA_PKG, "client/src/index.js": "fetch(process.env.REACT_APP_API_URL + '/x')",
             "server/package.json": pkg({"express": "4"}, {"start": "node index.js"}),
             "server/index.js": "app.listen(process.env.PORT)"}
    a, _, info, fs = full(paths, files)
    assert (a.stack, a.app_dir) == ("react-cra", "client")
    assert fs.backend.framework == "express" and fs.wiring_kind == "env" and fs.env_names == ["REACT_APP_API_URL"]
    assert fs.backend_dir == "server"


def test_vite_plus_flask_hardcoded_localhost_records_every_origin():
    src = "fetch('http://localhost:5000/a'); fetch(`http://127.0.0.1:5001/b`); const x = 'http://example.com:80'"
    files = {"frontend/package.json": VITE_PKG, "frontend/src/App.jsx": src,
             "backend/requirements.txt": "flask\n", "backend/app.py": "app = Flask(__name__)\n"}
    a, _, _, fs = full(VITE_PATHS + list(k for k in files if k.startswith("backend")), files)
    assert fs.wiring_kind == "localhost"
    assert fs.localhost_urls == ["http://127.0.0.1:5001", "http://localhost:5000"]
    assert "fullstack-wiring" in ids(a, "ok")


def test_dev_proxy_warns_with_a_precise_fix_and_still_deploys():
    paths, files = vite_fastapi("fetch('/api/notes')", {"frontend/vite.config.js":
                                "export default { server: { proxy: { '/api': 'http://x' } } }"},
                                ["frontend/vite.config.js"])
    a, _, info, fs = full(paths, files)
    assert fs.wiring_kind == "proxy" and a.verdict == "warnings" and info is not None
    w = next(f for f in a.findings if f.id == "fullstack-wiring")
    assert w.severity == "warn" and "VITE_API_URL instead of the dev proxy" in w.fix


def test_no_api_address_found_warns():
    paths, files = vite_fastapi("export default function App(){ return null }")
    a, _, _, fs = full(paths, files)
    assert fs.wiring_kind == "none" and "fullstack-wiring" in ids(a, "warn")


def test_unsupported_env_prefix_is_classified_unsupported():
    paths, files = vite_fastapi("const u = process.env.NEXT_PUBLIC_API_URL; const v = import.meta.env.BASE_URL")
    a, _, _, fs = full(paths, files)
    assert fs.wiring_kind == "unsupported" and fs.unsupported_names == ["NEXT_PUBLIC_API_URL"]
    assert fs.env_names == []
    d = next(f for f in a.findings if f.id == "fullstack-wiring").detail
    assert "NEXT_PUBLIC_API_URL" in d and "cannot verify the wiring" in d and "may not reach the server" in d


def test_wrong_prefix_for_the_stack_is_unsupported():
    paths, files = vite_fastapi("const u = process.env.REACT_APP_API_URL")  # a Vite build never sets this
    _, _, _, fs = full(paths, files)
    assert fs.wiring_kind == "unsupported"


def test_env_names_come_from_env_example_too():
    paths, files = vite_fastapi("x", {"frontend/.env.example": "VITE_BACKEND_URL=http://localhost:8000\nOTHER=1\n"},
                                ["frontend/.env.example"])
    _, _, _, fs = full(paths, files)
    assert fs.wiring_kind == "env" and fs.env_names == ["VITE_BACKEND_URL"]


def test_env_wins_over_a_localhost_fallback():
    _, _, _, fs = full(*vite_fastapi("import.meta.env.VITE_API_URL || 'http://localhost:8000'"))
    assert fs.wiring_kind == "env" and fs.localhost_urls == ["http://localhost:8000"]


def test_vite_plus_django():
    paths = VITE_PATHS + ["backend/manage.py", "backend/requirements.txt", "backend/mysite/wsgi.py",
                          "backend/mysite/settings.py"]
    files = {"frontend/package.json": VITE_PKG, "frontend/src/App.jsx": "import.meta.env.VITE_API_URL",
             "backend/requirements.txt": "django\ngunicorn\n", "backend/mysite/settings.py": "DATABASES = {}"}
    a, _, info, fs = full(paths, files)
    assert fs.backend.framework == "django" and fs.backend.django_project == "mysite"
    assert a.stack == "react-vite"


def test_backend_with_its_own_cors_is_recorded():
    files = {**vite_fastapi("x")[1], "backend/main.py": "app = FastAPI()\napp.add_middleware(CORSMiddleware)\n"}
    a, _, _, fs = full(vite_fastapi("x")[0], files)
    assert fs.app_cors is True and "backend-cors" in ids(a, "ok")
    assert detect.backend_has_cors(fs.backend, "backend", {"backend/main.py": "app = FastAPI()"}) is False


def test_express_cors_package_is_detected():
    info = detect.BackendInfo(framework="express", runtime="node", entry="npm start", app_port=3000)
    assert detect.backend_has_cors(info, "server", {"server/index.js": "const cors = require('cors')"})


def test_blocked_backend_blocks_the_whole_resurrection():
    paths, files = vite_fastapi("import.meta.env.VITE_API_URL", {"backend/main.py": "print('no app')"})
    a, _, info, fs = full(paths, files)
    assert a.verdict == "blocked" and info is None and fs is None
    assert "stack-fastapi" in ids(a, "block")
    b = next(f for f in a.findings if f.id == "fullstack-backend-blocked")
    assert "frontend in frontend looked fine" in b.detail and "backend in backend is the blocker" in b.detail


def test_same_folder_is_not_full_stack():
    paths = ["package.json", "index.html", "src/App.jsx"]
    files = {"package.json": pkg({"react": "1", "vite": "5", "express": "4"}), "src/App.jsx": "x"}
    assert full(paths, files)[3] is None


# ---- today's behaviour must not move -------------------------------------------------------------

def test_frontend_only_and_backend_only_repos_are_unchanged():
    fe_paths, fe_files = VITE_PATHS, {"frontend/package.json": VITE_PKG}
    a, _, info, fs = full(fe_paths, fe_files)
    assert fs is None and info is None and a.stack == "react-vite"
    assert a.model_dump() == autopsy.analyze_full(fe_paths, fe_files, backends=True, fullstack=False)[0].model_dump()
    a, _, info, fs = full(FASTAPI_PATHS, FASTAPI)
    assert fs is None and info.framework == "fastapi" and a.stack == "python"


def test_flag_off_gives_todays_exact_result_including_picks_frontend():
    paths, files = vite_fastapi("import.meta.env.VITE_API_URL")
    on_ = full(paths, files, fullstack=True)
    off_ = full(paths, files, fullstack=False)
    assert off_[3] is None and off_[2] is None                   # no backend, no full-stack record
    assert off_[0].stack == "react-vite" and off_[0].app_dir == "frontend"
    assert not any(f.id.startswith(("fullstack", "backend-cors")) for f in off_[0].findings)
    assert on_[3] is not None
    # byte-for-byte: identical to the call that predates B5
    old = autopsy.analyze_ex(paths, files, backends=True)
    assert old[0].model_dump() == off_[0].model_dump() and old[2] is None


def test_settings_flag_needs_both_flags(monkeypatch):
    monkeypatch.setenv("FULLSTACK_ENABLED", "true")
    monkeypatch.setenv("BACKENDS_ENABLED", "false")
    assert config.settings().fullstack_enabled is False
    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    assert config.settings().fullstack_enabled is True
    monkeypatch.delenv("FULLSTACK_ENABLED")
    assert config.settings().fullstack_enabled is False


# ---- fetching -------------------------------------------------------------------------------------

def _run_with(monkeypatch, paths, files, fullstack_on):
    fetched = []

    def raw(client, owner, name, branch, wanted):
        fetched.append(list(wanted))
        return {p: files[p] for p in wanted if p in files}

    monkeypatch.setenv("BACKENDS_ENABLED", "true")
    monkeypatch.setenv("FULLSTACK_ENABLED", "true" if fullstack_on else "false")
    monkeypatch.setattr(github, "fetch_repo", lambda *a: {"owner": {"login": "o"}, "name": "n", "default_branch": "main"})
    monkeypatch.setattr(github, "fetch_tree_and_sha", lambda *a: (paths, "abc1234"))
    monkeypatch.setattr(github, "fetch_raw_files", raw)
    res = autopsy.run(github.ParsedUrl("o", "n", None))
    return res, fetched


def test_run_fetches_sources_and_backend_entry_only_with_the_flag(monkeypatch):
    paths, files = vite_fastapi("import.meta.env.VITE_API_URL")
    res, fetched = _run_with(monkeypatch, paths, files, True)
    assert res.fullstack and res.fullstack.wiring_kind == "env" and res.backend is res.fullstack.backend
    flat = [p for r in fetched for p in r]
    assert "frontend/src/App.jsx" in flat and "backend/main.py" in flat
    assert all(len(r) <= 24 for r in fetched)

    res, fetched_off = _run_with(monkeypatch, paths, files, False)
    assert res.fullstack is None
    assert "frontend/src/App.jsx" not in [p for r in fetched_off for p in r]
    assert len(fetched_off) == 2                                  # today's two rounds, nothing more


def test_run_does_not_fetch_extra_for_frontend_only_repos(monkeypatch):
    res, fetched = _run_with(monkeypatch, VITE_PATHS, {"frontend/package.json": VITE_PKG}, True)
    assert res.fullstack is None
    assert "frontend/src/App.jsx" not in [p for r in fetched for p in r]


def test_source_file_cap_and_skips_tests():
    paths = ["frontend/src/f%02d.js" % i for i in range(40)] + ["frontend/src/a.test.js", "frontend/src/t.d.ts"]
    got = detect.frontend_source_files("frontend", paths + ["frontend/.env.example"])
    assert len(got) == detect.MAX_SOURCE_FILES + 1 and "frontend/src/a.test.js" not in got


@pytest.mark.parametrize("name", ["NEXT_PUBLIC_API_URL", "GATSBY_API_URL", "EXPO_PUBLIC_BACKEND_URL",
                                  "NUXT_PUBLIC_API_BASE", "PUBLIC_API_URL", "API_URL", "SERVER_URL"])
def test_every_other_prefix_is_unsupported(name):
    _, _, _, fs = full(*vite_fastapi("const u = process.env.%s" % name))
    assert fs.wiring_kind == "unsupported" and fs.unsupported_names == [name] and fs.env_names == []


def test_a_localhost_proxy_target_in_vite_config_is_not_a_hardcoded_api_call():
    cfg = "export default { server: { proxy: { '/api': 'http://localhost:8000' } } }"
    paths, files = vite_fastapi('fetch("/api" + "/notes")', {"frontend/vite.config.js": cfg}, ["frontend/vite.config.js"])
    _, _, _, fs = full(paths, files)
    assert fs.wiring_kind == "proxy" and fs.localhost_urls == []
