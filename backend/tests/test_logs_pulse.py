import httpx
import respx

from app import config, logs, pulse
from helpers import FakeLogs, make_record

GRAVES = "https://graves.example.net"
ECHO = 'echo "::resurrect:: phase=building"'
REAL = "::resurrect:: phase=building"


# ---- log parsing -----------------------------------------------------------

def test_strip_ansi():
    assert logs.strip_ansi("\x1b[1;32mdone\x1b[0m \x1b[?25h") == "done "


def test_marker_lines_are_hidden_including_echoed():
    events = [
        {"timestamp": 1000, "message": "\x1b[1m::resurrect:: phase=cloning\x1b[0m\n"},
        {"timestamp": 2000, "message": "[Container] Running command " + ECHO},
        {"timestamp": 3000, "message": "        " + ECHO},
        {"timestamp": 4000, "message": "  " + REAL},
        {"timestamp": 5000, "message": "added 120 packages in 4s\n"},
    ]
    lines, phase = logs.parse_events(events)
    assert [ln.text for ln in lines] == ["added 120 packages in 4s"]
    assert phase == "Building"  # latest REAL marker; echoed text never counts


def test_echoed_marker_alone_does_not_set_phase():
    lines, phase = logs.parse_events([{"timestamp": 1000, "message": ECHO}])
    assert lines == [] and phase is None


def test_all_phase_messages_and_done_unchanged():
    for name, msg in [("cloning", "Cloning the grave"), ("installing", "Installing dependencies"),
                      ("building", "Building"), ("uploading", "Uploading the remains")]:
        assert logs.parse_events([{"timestamp": 1, "message": f"::resurrect:: phase={name}"}])[1] == msg
    assert logs.parse_events([{"timestamp": 1, "message": "::resurrect:: phase=done"}])[1] is None


def test_latest_marker_wins():
    events = [{"timestamp": 1, "message": "::resurrect:: phase=cloning"},
              {"timestamp": 2, "message": "::resurrect:: phase=installing"}]
    assert logs.parse_events(events)[1] == "Installing dependencies"


def test_cursor_roundtrip_and_garbage():
    assert logs.decode_cursor(logs.encode_cursor("f/12", 3)) == ("f/12", 3)
    assert logs.decode_cursor("!!!not-base64") == (None, 0)
    assert logs.decode_cursor(None) == (None, 0)


# ---- fetch with a fake CloudWatch -------------------------------------------

def use_logs(monkeypatch, fake):
    monkeypatch.setattr(config, "client", lambda name: fake)


def test_fetch_before_stream_returns_same_cursor():
    rec = make_record()
    page = logs.fetch(rec, None)
    assert page.lines == [] and page.cursor is None and not page.new_events
    page = logs.fetch(rec, "abc")
    assert page.cursor == "abc"


def test_fetch_cursor_advances_and_goes_quiet(monkeypatch):
    fake = FakeLogs(["::resurrect:: phase=cloning", "Cloning into 'src'...", "hello"])
    use_logs(monkeypatch, fake)
    rec = make_record()
    rec.log_stream = "s"
    first = logs.fetch(rec, None)
    assert [ln.text for ln in first.lines] == ["Cloning into 'src'...", "hello"]
    assert first.phase_message == "Cloning the grave" and first.new_events
    second = logs.fetch(rec, first.cursor)
    assert second.lines == [] and not second.new_events
    assert second.cursor == first.cursor
    fake.add("more output")
    third = logs.fetch(rec, second.cursor)
    assert [ln.text for ln in third.lines] == ["more output"]


def test_fetch_merges_pulse_lines_once(monkeypatch):
    use_logs(monkeypatch, FakeLogs(["a"]))
    rec = make_record()
    rec.log_stream = "s"
    from app.models import LogLine
    rec.pulse_lines.append(LogLine(ts="2026-11-04T07:32:00Z", text="Pulse check 1/20: nope", kind="pulse"))
    first = logs.fetch(rec, None)
    assert [ln.kind for ln in first.lines] == ["build", "pulse"]
    second = logs.fetch(rec, first.cursor)
    assert second.lines == []
    rec.pulse_lines.append(LogLine(ts="2026-11-04T07:32:02Z", text="Pulse check 2/20: ok", kind="pulse"))
    third = logs.fetch(rec, second.cursor)
    assert [ln.text for ln in third.lines] == ["Pulse check 2/20: ok"]


def test_fetch_missing_stream_is_empty(monkeypatch):
    class Gone:
        def get_log_events(self, **kw):
            exc = Exception("nope")
            exc.response = {"Error": {"Code": "ResourceNotFoundException"}}
            raise exc

    use_logs(monkeypatch, Gone())
    rec = make_record()
    rec.log_stream = "s"
    page = logs.fetch(rec, None)
    assert page.lines == [] and page.cursor is None


def test_tail_hides_markers_and_caps(monkeypatch):
    fake = FakeLogs([f"line {i}" for i in range(120)] + [REAL])
    use_logs(monkeypatch, fake)
    rec = make_record()
    rec.log_stream = "s"
    tail = logs.tail(rec, 80)
    assert len(tail) == 80 and tail[-1] == "line 119" and not any("resurrect" in t for t in tail)


# ---- pulse ------------------------------------------------------------------

HTML = ('<!doctype html><html><head><link rel="icon" href="/r-abc123/favicon.svg">'
        '<script type="module" crossorigin src="/r-abc123/assets/index-1.js"></script>'
        '<link rel="stylesheet" crossorigin href="/r-abc123/assets/index-1.css"></head><body></body></html>')


def test_pick_asset_prefers_script_then_stylesheet_then_any():
    assert pulse.pick_asset(HTML, "r-abc123") == "/r-abc123/assets/index-1.js"
    no_script = HTML.replace('<script type="module" crossorigin src="/r-abc123/assets/index-1.js"></script>', "")
    assert pulse.pick_asset(no_script, "r-abc123") == "/r-abc123/assets/index-1.css"
    only_icon = '<html><link rel="icon" href="/r-abc123/favicon.svg"></html>'
    assert pulse.pick_asset(only_icon, "r-abc123") == "/r-abc123/favicon.svg"
    assert pulse.pick_asset("<html><script src='/assets/x.js'></script></html>", "r-abc123") is None


def test_pick_asset_catches_wrong_base_path():
    # Built without --base: assets point at /assets/, not /<id>/assets/ -> nothing under the id
    assert pulse.pick_asset('<html><script src="/assets/index.js"></script></html>', "r-abc123") is None


@respx.mock
def test_probe_pass():
    respx.get(f"{GRAVES}/r-abc123/").respond(200, text=HTML)
    respx.get(f"{GRAVES}/r-abc123/assets/index-1.js").respond(200, text="x")
    result = pulse.probe(GRAVES, "r-abc123")
    assert result.ok and len(result.details) == 2


@respx.mock
def test_probe_asset_404_fails():
    respx.get(f"{GRAVES}/r-abc123/").respond(200, text=HTML)
    respx.get(f"{GRAVES}/r-abc123/assets/index-1.js").respond(404)
    result = pulse.probe(GRAVES, "r-abc123")
    assert not result.ok and "404" in result.summary


@respx.mock
def test_probe_page_not_200_and_no_html_and_timeout():
    respx.get(f"{GRAVES}/r-abc123/").respond(404, text="Rest in peace")
    assert not pulse.probe(GRAVES, "r-abc123").ok
    respx.get(f"{GRAVES}/r-abc123/").respond(200, text="just text")
    assert not pulse.probe(GRAVES, "r-abc123").ok
    respx.get(f"{GRAVES}/r-abc123/").mock(side_effect=httpx.ReadTimeout("slow"))
    result = pulse.probe(GRAVES, "r-abc123")
    assert not result.ok and "did not answer" in result.summary


@respx.mock
def test_probe_static_page_without_assets_passes():
    respx.get(f"{GRAVES}/r-abc123/").respond(200, text="<html><body>hi</body></html>")
    assert pulse.probe(GRAVES, "r-abc123").ok
