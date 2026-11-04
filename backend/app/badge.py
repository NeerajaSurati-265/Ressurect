"""STUB for B3 polish: a simple README badge."""
from __future__ import annotations

from xml.sax.saxutils import escape


def render(label_text: str, alive: bool) -> str:
    color = "#2e7d32" if alive else "#616161"
    right = escape(label_text)
    width = 96 + 7 * len(label_text)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" role="img" aria-label="resurrected: {right}">'
        f'<rect width="86" height="20" fill="#2b2b2b"/><rect x="86" width="{width - 86}" height="20" fill="{color}"/>'
        '<g fill="#fff" font-family="Verdana,sans-serif" font-size="11">'
        '<text x="8" y="14">resurrected</text>'
        f'<text x="94" y="14">{right}</text></g></svg>'
    )
