from app import bedrock, ghost
from app.models import Finding

F = [Finding(id="stack-vite", severity="ok", title="Vite", detail="d")]
LOG = ["::resurrect:: phase=building"] + ["line %d" % i for i in range(100)] + [
    "AWS_SECRET_ACCESS_KEY=abcd1234", "error: Cannot find module 'react-router-dom'"]


def stub(monkeypatch, reply, seen=None):
    def fake(system, user, max_tokens=500, timeout_s=8):
        if seen is not None:
            seen.update(system=system, user=user, timeout=timeout_s)
        return reply
    monkeypatch.setattr(bedrock, "converse_json", fake)


GOOD = {"cause": "react-router-dom is imported but not installed.", "fix": "Install it.",
        "command": "npm install react-router-dom", "confidence": "high"}


def test_valid_ghost(monkeypatch):
    seen = {}
    stub(monkeypatch, GOOD, seen)
    g = ghost.explain("react-vite", F, '{"name":"x"}', LOG)
    assert g.source == "llm" and g.command == "npm install react-router-dom" and g.confidence == "high"
    assert seen["system"] == ghost.GHOST_SYSTEM_PROMPT and seen["timeout"] == 8
    assert "::resurrect::" not in seen["user"] and "abcd1234" not in seen["user"]


def test_raw_tail_is_last_10_scrubbed_visible_lines(monkeypatch):
    stub(monkeypatch, GOOD)
    g = ghost.explain("react-vite", F, None, LOG)
    assert len(g.raw_tail) == 10 and g.raw_tail[-1].startswith("error:")
    assert not any("::resurrect::" in ln for ln in g.raw_tail)
    assert "AWS_SECRET_ACCESS_KEY=[REDACTED]" in g.raw_tail
    assert "abcd1234" not in " ".join(g.raw_tail)


def test_invalid_replies_give_fallback(monkeypatch):
    for bad in (None, {}, {"cause": "", "fix": "x", "confidence": "high"},
                {"cause": "c", "fix": "f", "command": None, "confidence": "certain"},
                {"cause": "c", "fix": "f", "command": 5, "confidence": "low"}):
        stub(monkeypatch, bad)
        g = ghost.explain("react-vite", F, None, LOG)
        assert g.source == "fallback" and g.confidence == "low" and g.command is None
        assert g.cause == ghost.FALLBACK_CAUSE and len(g.raw_tail) == 10


def test_dangerous_commands_become_null(monkeypatch):
    for cmd in ("rm -rf node_modules", "sudo npm i", "git push --force", "git reset --hard HEAD",
                "git rebase main", "npm i && rm -rf /"):
        stub(monkeypatch, {**GOOD, "command": cmd})
        g = ghost.explain("react-vite", F, None, LOG)
        assert g.source == "llm" and g.command is None, cmd
    stub(monkeypatch, {**GOOD, "command": "npm install --save-dev vite"})
    assert ghost.explain("react-vite", F, None, LOG).command == "npm install --save-dev vite"


def test_pulse_failure_uses_probe_results(monkeypatch):
    seen = {}
    stub(monkeypatch, GOOD, seen)
    g = ghost.explain("react-vite", F, None, [], probe_results=["GET / -> 200", "GET /r-1/a.js -> 404"])
    assert "HTTP check results" in seen["user"] and g.raw_tail[-1] == "GET /r-1/a.js -> 404"


def test_summary_success(monkeypatch):
    stub(monkeypatch, {"summary": "A Vite app that should build.", "warnings": [
        {"title": "Big image", "detail": "logo.png is 9 MB", "fix": "Compress it", "file": "logo.png", "severity": "block"},
        {"title": "A", "detail": "b"}, {"title": "B", "detail": "c"}, {"title": "C", "detail": "d"}]})
    s, extras, src = ghost.autopsy_summary("react-vite", F, {"package.json": "{}"})
    assert src == "rules+llm" and s == "A Vite app that should build."
    assert len(extras) == 3 and all(e.severity == "warn" and e.id.startswith("llm-") for e in extras)
    assert extras[0].id == "llm-big-image" and extras[0].file == "logo.png"


def test_summary_llm_cannot_block(monkeypatch):
    stub(monkeypatch, {"summary": "ok", "warnings": [{"title": "t", "detail": "d", "severity": "block"}]})
    _, extras, _ = ghost.autopsy_summary("static", F, {})
    assert [e.severity for e in extras] == ["warn"]


def test_summary_failure_keeps_rules(monkeypatch):
    stub(monkeypatch, None)
    s, extras, src = ghost.autopsy_summary("react-vite", F, {})
    assert src == "rules" and extras == [] and "healthy" in s
    stub(monkeypatch, {"warnings": []})  # no summary
    assert ghost.autopsy_summary("react-vite", F, {})[2] == "rules"


BOILERPLATE = (["::resurrect:: phase=building", "✗ Build failed in 126ms", "error during build:",
                "Error: [vite]: Rolldown failed to resolve import \"react-router-dom\" from \"src/App.jsx\"."]
               + ["    at stack line %d" % i for i in range(30)]
               + ["[Container] 2026/11/04 Phase complete: BUILD State: FAILED",
                  "[Container] 2026/11/04 Phase context status code: COMMAND_EXECUTION_ERROR Message: Error while executing command: set -euo pipefail"]
               + ["script line %d" % i for i in range(60)]
               + [". Reason: exit status 1", "[Container] 2026/11/04 Entering phase POST_BUILD"])


def test_codebuild_boilerplate_does_not_hide_the_real_error(monkeypatch):
    seen = {}
    stub(monkeypatch, GOOD, seen)
    g = ghost.explain("react-vite", F, None, BOILERPLATE)
    assert "failed to resolve import \"react-router-dom\"" in seen["user"]
    assert "Lines that look like errors" in seen["user"]
    assert "script line" not in seen["user"] and "[Container]" not in seen["user"]
    assert not any("[Container]" in ln or "script line" in ln for ln in g.raw_tail)


def test_real_broken_potion_log(monkeypatch):
    """Saved CodeBuild log of the broken-potion repo: the tail must show the real error."""
    from pathlib import Path

    log = (Path(__file__).parent / "fixtures" / "broken_potion.log").read_text().splitlines()
    seen = {}
    stub(monkeypatch, GOOD, seen)
    g = ghost.explain("react-vite", F, None, log)
    assert len(g.raw_tail) == 10
    assert any('failed to resolve import "react-router-dom"' in ln for ln in g.raw_tail)
    joined = "\n".join(g.raw_tail)
    assert "[Container]" not in joined and "::resurrect::" not in joined
    assert "aws s3 sync" not in joined and "git clone" not in joined and "set -euo" not in joined
    # the model input is clean too, and leads with the error hint
    assert "git clone --depth 1" not in seen["user"] and "[Container]" not in seen["user"]
    assert "Rolldown failed to resolve import" in seen["user"].split("Last build log lines:")[0]


def test_tail_window_plain_last_10_when_no_error_nearby():
    lines = ["line %d" % i for i in range(50)]
    assert ghost.tail_window(lines) == lines[-10:]
    assert ghost.tail_window(["a", "b"]) == ["a", "b"]


def test_summary_drops_unverifiable_absence_claims(monkeypatch):
    stub(monkeypatch, {"summary": "A Vite app.", "warnings": [
        {"title": "Missing favicon", "detail": "The favicon is referenced but not provided in the key files."},
        {"title": "No routing library", "detail": "package.json does not include react-router-dom."},
        {"title": "Huge bundle", "detail": "index.html loads a 4 MB script from a CDN on every page."}]})
    _, extras, src = ghost.autopsy_summary("react-vite", F, {})
    assert [e.id for e in extras] == ["llm-huge-bundle"] and src == "rules+llm"
