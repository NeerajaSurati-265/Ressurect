"""README badge: a flat, shields.io-style SVG whose right half shows the resurrection's state."""
from __future__ import annotations

from typing import Optional, Tuple
from xml.sax.saxutils import escape

LEFT_TEXT = "resurrected"
LEFT_COLOR = "#161A33"
GREY = "#6B7280"
# state -> (label, background, text colour)
STATES = {
    "alive": ("alive", "#7DE2D1", "#0B1020"),
    "pinned": ("eternal", "#FF8A1F", "#0B1020"),
    "expired": ("resting", GREY, "#FFFFFF"),
    "failed": ("haunted", "#E5484D", "#FFFFFF"),
    "cannot_rise": ("can't rise", GREY, "#FFFFFF"),
    "summoning": ("summoning", GREY, "#FFFFFF"),
    "unknown": ("unknown", GREY, "#FFFFFF"),
}
NO_CACHE = {"Cache-Control": "no-cache, max-age=0"}


def state_for(status: Optional[str], pinned: bool = False) -> str:
    if status is None:
        return "unknown"
    if status == "alive":
        return "pinned" if pinned else "alive"
    return status if status in ("expired", "failed", "cannot_rise") else "summoning"


def _text_width(text: str) -> int:
    narrow = sum(1 for c in text if c in "il1.,:;'!| tfjr")
    return int(round((len(text) - narrow) * 6.6 + narrow * 3.6)) + 12


def render(state: str) -> str:
    label, bg, fg = STATES.get(state, STATES["unknown"])
    lw, rw = _text_width(LEFT_TEXT), _text_width(label)
    total = lw + rw
    title = "%s: %s" % (LEFT_TEXT, label)
    safe_label, safe_title = escape(label), escape(title)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="20" role="img" aria-label="%s">'
        "<title>%s</title>"
        '<clipPath id="r"><rect width="%d" height="20" rx="3"/></clipPath>'
        '<g clip-path="url(#r)"><rect width="%d" height="20" fill="%s"/>'
        '<rect x="%d" width="%d" height="20" fill="%s"/></g>'
        '<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">'
        '<text x="%s" y="14" fill="#FFFFFF">%s</text>'
        '<text x="%s" y="14" fill="%s">%s</text></g></svg>'
    ) % (total, safe_title, safe_title, total, lw, LEFT_COLOR, lw, rw, bg,
         lw / 2.0, LEFT_TEXT, lw + rw / 2.0, fg, safe_label)


def response_parts(status: Optional[str], pinned: bool = False) -> Tuple[str, int]:
    """(svg, http_status). Unknown ids get a 404 SVG that says "unknown"."""
    state = state_for(status, pinned)
    return render(state), (404 if status is None else 200)
