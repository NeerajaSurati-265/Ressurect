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


@pytest.mark.parametrize("text,kept", [
    ("MONGO_URL=mongodb://admin:hunter2@localhost:27017/db", "mongodb://admin:[REDACTED]@localhost:27017/db"),
    ("connect postgres://app:s3cr3t!@db.example.com/x failed", "postgres://app:[REDACTED]@db.example.com/x"),
    ("redis://:pw@h", None),
])
def test_url_credentials_redacted(text, kept):
    out = scrub(text)
    assert "hunter2" not in out and "s3cr3t" not in out
    if kept:
        assert kept in out


def test_urls_without_credentials_untouched():
    for t in ("https://github.com/o/n", "mongodb://localhost:27017/db", "GET http://127.0.0.1:8000/docs -> 200"):
        assert scrub(t) == t
