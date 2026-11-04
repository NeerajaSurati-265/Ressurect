import pytest

from app.scrub import REDACTED, cap_text, scrub


@pytest.mark.parametrize("text", [
    "key AKIAIOSFODNN7EXAMPLE here",
    "key ASIAIOSFODNN7EXAMPLE here",
    "tok ghp_" + "a" * 36,
    "tok gho_" + "b" * 36,
    "tok ghu_" + "c" * 36,
    "tok ghs_" + "d" * 36,
    "tok github_pat_" + "e" * 30,
    "openai sk-" + "f" * 32,
    "slack xoxb-1234567890-abcdefghij",
    "slack xoxp-1234567890-abcdefghij",
])
def test_token_patterns_redacted(text):
    out = scrub(text)
    assert REDACTED in out
    assert "AKIAIOSFODNN7EXAMPLE" not in out and "ghp_a" not in out and "sk-ff" not in out


def test_pem_block_multiline():
    pem = "x\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\ndef\n-----END RSA PRIVATE KEY-----\ny"
    out = scrub(pem)
    assert out == "x\n" + REDACTED + "\ny"


@pytest.mark.parametrize("text,gone", [
    ("MY_SECRET=hunter2", "hunter2"),
    ("password: swordfish", "swordfish"),
    ("API_KEY=abc123", "abc123"),
    ("apikey = 'xyz789'", "xyz789"),
    ('"authToken": "zzz999"', "zzz999"),
    ("NPM_TOKEN=npm_abcdef", "npm_abcdef"),
])
def test_key_value_redacted(text, gone):
    out = scrub(text)
    assert gone not in out and REDACTED in out


@pytest.mark.parametrize("text", [
    "npm ERR! Cannot find module 'react-router-dom'",
    "AKIA short", "ghp_short", "sk-short", "username=bob", "built in 3.2s",
    "tokenizer loaded",
])
def test_negative_cases_untouched(text):
    assert scrub(text) == text


def test_cap_keeps_the_end():
    text = "\n".join("line%04d" % i for i in range(5000))
    out = cap_text(text, 1000)
    assert len(out.encode()) <= 1000 and out.endswith("line4999")
    assert cap_text("short", 1000) == "short"
