import pytest

from app import bedrock


@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('Sure! Here you go: {"a": {"b": 2}} hope it helps', {"a": {"b": 2}}),
    ('{"a": 1} trailing words', {"a": 1}),
    ('{"a": 1} and {"b": 2}', {"a": 1}),
    ('{not json} {"ok": true}', {"ok": True}),
    ("{broken", None),
    ("", None),
    ("[1, 2]", None),
])
def test_extract_json(text, expected):
    assert bedrock.extract_json(text) == expected


class FakeRuntime:
    def __init__(self, text=None, exc=None):
        self.text, self.exc, self.kw = text, exc, None

    def converse(self, **kw):
        self.kw = kw
        if self.exc:
            raise self.exc
        return {"output": {"message": {"content": [{"text": self.text}]}}}


def test_converse_json_ok(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "m")
    fake = FakeRuntime('```json\n{"cause": "x"}\n```')
    monkeypatch.setattr(bedrock, "_runtime", lambda t: fake)
    assert bedrock.converse_json("sys", "usr", 100, 3) == {"cause": "x"}
    assert fake.kw["modelId"] == "m" and fake.kw["inferenceConfig"]["temperature"] == 0.2


def test_converse_json_errors_give_none(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "m")
    monkeypatch.setattr(bedrock, "_runtime", lambda t: FakeRuntime(exc=TimeoutError("slow")))
    assert bedrock.converse_json("s", "u") is None
    monkeypatch.setattr(bedrock, "_runtime", lambda t: FakeRuntime("no json here"))
    assert bedrock.converse_json("s", "u") is None
    monkeypatch.delenv("BEDROCK_MODEL_ID")
    assert bedrock.converse_json("s", "u") is None
