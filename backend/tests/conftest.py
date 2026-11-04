import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

os.environ.update({
    "TABLE_NAME": "resurrect-records",
    "BUCKET": "resurrect-test",
    "UI_URL": "https://ui.example.net",
    "GRAVES_URL": "https://graves.example.net",
    "CODEBUILD_PROJECT": "resurrect-build",
    "LOG_GROUP": "/resurrect/builds",
    "LIFETIME_MINUTES": "20",
    "RESURRECTIONS_ENABLED": "true",
})


class FakeConditionalError(Exception):
    def __init__(self):
        self.response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class FakeTable:
    """Just enough of a DynamoDB Table for store.py's two conditional writes."""

    def __init__(self):
        self.items = {}
        self.fail_next_save = False  # simulate losing a version race

    def get_item(self, Key):
        item = self.items.get(Key["pk"])
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item, ConditionExpression=None, ExpressionAttributeNames=None,
                 ExpressionAttributeValues=None):
        existing = self.items.get(Item["pk"])
        if ConditionExpression and "attribute_not_exists" in ConditionExpression:
            if existing:
                raise FakeConditionalError()
        elif ConditionExpression:
            if self.fail_next_save:
                self.fail_next_save = False
                raise FakeConditionalError()
            if not existing or int(existing["version"]) != ExpressionAttributeValues[":expected"]:
                raise FakeConditionalError()
        self.items[Item["pk"]] = dict(Item)


@pytest.fixture
def table(monkeypatch):
    from app import store

    t = FakeTable()
    monkeypatch.setattr(store, "_table", lambda: t)
    return t


@pytest.fixture(autouse=True)
def _no_real_bedrock(request, monkeypatch):
    """Tests never call Bedrock unless they stub it themselves."""
    from app import bedrock

    def boom(*a, **k):
        raise RuntimeError("real Bedrock client requested in a test")

    monkeypatch.setattr(bedrock, "_runtime", boom)
    if request.module.__name__ != "test_bedrock":
        monkeypatch.setattr(bedrock, "converse_json", lambda *a, **k: None)


class _AllowAllCounters:
    def update_item(self, **kw):
        return {}


@pytest.fixture(autouse=True)
def _no_real_aws(monkeypatch):
    """Tests must never reach real AWS. Counters allow everything unless a test fakes them."""
    from app import config, limits

    def boom(*a, **k):
        raise RuntimeError("real AWS client requested in a test; fake it")

    monkeypatch.setattr(config, "client", boom)
    monkeypatch.setattr(config, "resource", boom)
    monkeypatch.setattr(limits, "_table", lambda: _AllowAllCounters())
    monkeypatch.setattr(limits, "_admin_secret", lambda: None)
