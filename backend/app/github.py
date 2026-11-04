"""GitHub access for the autopsy: URL parsing, repo metadata, file tree, raw files."""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import httpx

from . import config
from .errors import ApiException

logger = logging.getLogger(__name__)

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
TIMEOUT = httpx.Timeout(4.0, connect=2.0)
MAX_REPO_KB = 102_400

_URL_RE = re.compile(
    r"^https://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?"
    r"(?:/tree/([^?#\s]+))?/?$"
)


@dataclass
class ParsedUrl:
    owner: str
    name: str
    branch: Optional[str]

    @property
    def url(self) -> str:
        return f"https://github.com/{self.owner}/{self.name}"


def parse_repo_url(url: str) -> ParsedUrl:
    m = _URL_RE.match((url or "").strip())
    if not m or m.group(1) in (".", "..") or m.group(2) in (".", ".."):
        raise ApiException("invalid_url", "Paste a link like https://github.com/owner/repo.")
    return ParsedUrl(owner=m.group(1), name=m.group(2), branch=m.group(3))


def _headers(accept: str = "application/vnd.github+json") -> Dict[str, str]:
    headers = {"Accept": accept, "User-Agent": "resurrect", "X-GitHub-Api-Version": "2022-11-28"}
    token = config.github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(client: httpx.Client, url: str, accept: str = "application/vnd.github+json") -> httpx.Response:
    try:
        return client.get(url, headers=_headers(accept))
    except httpx.HTTPError as exc:
        logger.warning("GitHub request failed: %s", exc)
        raise ApiException("internal", "GitHub did not answer in time. Try again in a moment.")


def fetch_repo(client: httpx.Client, owner: str, name: str) -> dict:
    resp = _get(client, f"{API}/repos/{owner}/{name}")
    if resp.status_code == 404:
        raise ApiException("repo_not_found", "We can't find that repo. Is it public and spelled right?")
    if resp.status_code != 200:
        logger.warning("GitHub repo lookup returned %s", resp.status_code)
        raise ApiException("internal", "GitHub is not answering properly right now. Try again soon.")
    data = resp.json()
    if data.get("private"):
        raise ApiException("repo_not_found", "That repo is private. Resurrect only works on public repos.")
    if int(data.get("size", 0)) > MAX_REPO_KB:
        raise ApiException("repo_too_large", "That repo is over 100 MB, which is too big to resurrect.")
    return data


def fetch_tree(client: httpx.Client, owner: str, name: str, branch: str) -> List[str]:
    resp = _get(client, f"{API}/repos/{owner}/{name}/git/trees/{branch}?recursive=1")
    if resp.status_code == 409:  # empty repository
        return []
    if resp.status_code == 404:
        raise ApiException("repo_not_found", "We can't read that repo's default branch.")
    if resp.status_code != 200:
        raise ApiException("internal", "GitHub would not list the repo's files. Try again soon.")
    return [e["path"] for e in resp.json().get("tree", []) if e.get("type") == "blob"]


def fetch_commit_sha(client: httpx.Client, owner: str, name: str, branch: str) -> Optional[str]:
    resp = _get(client, f"{API}/repos/{owner}/{name}/commits/{branch}", "application/vnd.github.sha")
    if resp.status_code != 200:
        return None
    return resp.text.strip()[:7] or None


def fetch_raw(client: httpx.Client, owner: str, name: str, branch: str, path: str) -> Optional[str]:
    try:
        resp = client.get(f"{RAW}/{owner}/{name}/{branch}/{path}", headers={"User-Agent": "resurrect"})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.text[:200_000]


def fetch_tree_and_sha(client: httpx.Client, owner: str, name: str,
                       branch: str) -> Tuple[List[str], Optional[str]]:
    with ThreadPoolExecutor(max_workers=2) as pool:
        tree = pool.submit(fetch_tree, client, owner, name, branch)
        sha = pool.submit(fetch_commit_sha, client, owner, name, branch)
        return tree.result(), sha.result()


def fetch_raw_files(client: httpx.Client, owner: str, name: str, branch: str,
                    paths: List[str]) -> Dict[str, str]:
    if not paths:
        return {}
    with ThreadPoolExecutor(max_workers=len(paths)) as pool:
        results = list(pool.map(lambda p: fetch_raw(client, owner, name, branch, p), paths))
    return {p: body for p, body in zip(paths, results) if body is not None}
