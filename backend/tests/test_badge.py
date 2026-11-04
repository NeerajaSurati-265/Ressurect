import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app import badge, main, store
from tests.helpers import make_record

NS = "{http://www.w3.org/2000/svg}"


def texts(svg):
    root = ET.fromstring(svg)
    return root, [t.text for t in root.iter(NS + "text")], [r.get("fill") for r in root.iter(NS + "rect")]


@pytest.mark.parametrize("status,pinned,label,color", [
    ("alive", False, "alive", "#7DE2D1"),
    ("alive", True, "eternal", "#FF8A1F"),
    ("expired", False, "resting", "#6B7280"),
    ("failed", False, "haunted", "#E5484D"),
    ("cannot_rise", False, "can't rise", "#6B7280"),
    ("building", False, "summoning", "#6B7280"),
    ("checking_pulse", False, "summoning", "#6B7280"),
])
def test_each_state_is_valid_xml_with_label_and_colour(status, pinned, label, color):
    svg, code = badge.response_parts(status, pinned)
    root, ts, fills = texts(svg)
    assert code == 200 and ts == ["resurrected", label]
    assert "#161A33" in fills and color in fills
    assert root.find(NS + "title").text == "resurrected: " + label


def test_alive_has_dark_text_and_unknown_is_404():
    svg, _ = badge.response_parts("alive")
    assert 'fill="#0B1020"' in svg
    svg, code = badge.response_parts(None)
    assert code == 404 and texts(svg)[1] == ["resurrected", "unknown"]


def test_route_headers_and_404(table):
    client = TestClient(main.app)
    store.create(make_record("alive"))
    r = client.get("/badge/r-abc123.svg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    assert r.headers["cache-control"] == "no-cache, max-age=0" and "alive" in r.text
    r = client.get("/badge/r-nope00.svg")
    assert r.status_code == 404 and "unknown" in r.text and r.headers["cache-control"] == "no-cache, max-age=0"
