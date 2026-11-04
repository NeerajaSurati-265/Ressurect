"""Pulse check: is the deployed site really up, and do its assets load from the right base path?"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

import httpx

TIMEOUT = 3.0

_SCRIPT_SRC = re.compile(r"<script\b[^>]*?\bsrc=[\"']([^\"']+)[\"']", re.I)
_LINK_TAG = re.compile(r"<link\b[^>]*>", re.I)
_HREF = re.compile(r"\bhref=[\"']([^\"']+)[\"']", re.I)
_ANY_ATTR = re.compile(r"\b(?:src|href)=[\"']([^\"']+)[\"']", re.I)


@dataclass
class ProbeResult:
    ok: bool
    summary: str
    details: List[str] = field(default_factory=list)


def pick_asset(html: str, res_id: str) -> Optional[str]:
    """First asset path under /<id>/: a <script src>, else a stylesheet <link>, else any src/href."""
    prefix = f"/{res_id}/"

    def under(path: str) -> bool:
        return path.startswith(prefix) and len(path) > len(prefix)

    for m in _SCRIPT_SRC.finditer(html):
        if under(m.group(1)):
            return m.group(1)
    for tag in _LINK_TAG.findall(html):
        if re.search(r"\brel=[\"']?stylesheet", tag, re.I):
            m = _HREF.search(tag)
            if m and under(m.group(1)):
                return m.group(1)
    for m in _ANY_ATTR.finditer(html):
        if under(m.group(1)):
            return m.group(1)
    return None


def probe(graves_url: str, res_id: str) -> ProbeResult:
    base = graves_url.rstrip("/")
    page_url = f"{base}/{res_id}/"
    details: List[str] = []
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            page = client.get(page_url)
            details.append(f"GET {page_url} -> {page.status_code}")
            if page.status_code != 200:
                return ProbeResult(False, f"The page answered HTTP {page.status_code}.", details)
            if "<html" not in page.text.lower():
                details.append("Response body has no <html tag")
                return ProbeResult(False, "The page answered but contained no HTML.", details)
            asset = pick_asset(page.text, res_id)
            if asset is None:
                details.append("No asset under the app's base path to check")
                return ProbeResult(True, "The page is up (no assets to check).", details)
            asset_resp = client.get(f"{base}{asset}")
            details.append(f"GET {base}{asset} -> {asset_resp.status_code}")
            if asset_resp.status_code != 200:
                return ProbeResult(False, f"The page loads, but {asset} answered HTTP {asset_resp.status_code}.",
                                   details)
            return ProbeResult(True, f"The page and {asset} both answered 200.", details)
    except httpx.HTTPError as exc:
        details.append(f"Request failed: {exc.__class__.__name__}")
        return ProbeResult(False, "The site did not answer in time.", details)
