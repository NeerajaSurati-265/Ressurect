import httpx
import pytest
import respx

from app import autopsy, config, github
from app.errors import ApiException


@pytest.fixture(autouse=True)
def no_ssm(monkeypatch):
    monkeypatch.setattr(config, "github_token", lambda: "tok")


def mock_repo(router, status=200, **fields):
    body = {"name": "todo", "owner": {"login": "rahul"}, "default_branch": "main", "size": 500, "private": False}
    body.update(fields)
    router.get("https://api.github.com/repos/rahul/todo").respond(status, json=body)


@respx.mock
def test_repo_not_found():
    mock_repo(respx, 404)
    with httpx.Client() as c, pytest.raises(ApiException) as e:
        github.fetch_repo(c, "rahul", "todo")
    assert (e.value.code, e.value.status) == ("repo_not_found", 404)


@respx.mock
def test_private_repo_is_not_found():
    mock_repo(respx, private=True)
    with httpx.Client() as c, pytest.raises(ApiException) as e:
        github.fetch_repo(c, "rahul", "todo")
    assert e.value.code == "repo_not_found"


@respx.mock
def test_repo_too_large():
    mock_repo(respx, size=102_401)
    with httpx.Client() as c, pytest.raises(ApiException) as e:
        github.fetch_repo(c, "rahul", "todo")
    assert (e.value.code, e.value.status) == ("repo_too_large", 422)


@respx.mock
def test_repo_at_limit_is_ok():
    mock_repo(respx, size=102_400)
    with httpx.Client() as c:
        assert github.fetch_repo(c, "rahul", "todo")["name"] == "todo"


@respx.mock
def test_full_run_vite_repo():
    mock_repo(respx)
    respx.get("https://api.github.com/repos/rahul/todo/git/trees/main", params={"recursive": "1"}).respond(
        200, json={"tree": [{"path": "package.json", "type": "blob"}, {"path": "index.html", "type": "blob"},
                            {"path": "package-lock.json", "type": "blob"}, {"path": "src", "type": "tree"}]})
    respx.get("https://api.github.com/repos/rahul/todo/commits/main").respond(200, text="9f2c1e7abcdef")
    respx.get("https://raw.githubusercontent.com/rahul/todo/main/package.json").respond(
        200, text='{"devDependencies":{"vite":"5"},"scripts":{"build":"vite build"}}')
    respx.get("https://raw.githubusercontent.com/rahul/todo/main/index.html").respond(200, text="<html>")
    r = autopsy.run(github.parse_repo_url("https://github.com/rahul/todo"))
    assert r.autopsy.stack == "react-vite" and r.autopsy.verdict == "healthy"
    assert r.repo.commit_sha == "9f2c1e7" and r.repo.default_branch == "main"
    assert r.package_json and "vite" in r.package_json


@respx.mock
def test_empty_repo_run():
    mock_repo(respx, size=0)
    respx.get("https://api.github.com/repos/rahul/todo/git/trees/main", params={"recursive": "1"}).respond(
        409, json={"message": "Git Repository is empty."})
    respx.get("https://api.github.com/repos/rahul/todo/commits/main").respond(409)
    r = autopsy.run(github.parse_repo_url("https://github.com/rahul/todo"))
    assert r.autopsy.verdict == "blocked" and r.repo.commit_sha is None


@respx.mock
def test_github_timeout_becomes_internal():
    respx.get("https://api.github.com/repos/rahul/todo").mock(side_effect=httpx.ConnectTimeout("slow"))
    with httpx.Client() as c, pytest.raises(ApiException) as e:
        github.fetch_repo(c, "rahul", "todo")
    assert e.value.code == "internal"


@respx.mock
def test_renamed_repo_follows_redirect_and_uses_canonical_url():
    respx.get("https://api.github.com/repos/old/name").respond(
        301, headers={"location": "https://api.github.com/repos/new/shiny"})
    respx.get("https://api.github.com/repos/new/shiny").respond(
        200, json={"name": "shiny", "owner": {"login": "new"}, "default_branch": "main", "size": 5, "private": False})
    respx.get("https://api.github.com/repos/new/shiny/git/trees/main", params={"recursive": "1"}).respond(
        200, json={"tree": [{"path": "index.html", "type": "blob"}]})
    respx.get("https://api.github.com/repos/new/shiny/commits/main").respond(200, text="abcdef1234")
    respx.get("https://raw.githubusercontent.com/new/shiny/main/index.html").respond(200, text="<html>")
    r = autopsy.run(github.parse_repo_url("https://github.com/old/name"))
    assert r.repo.url == "https://github.com/new/shiny" and r.autopsy.stack == "static"
