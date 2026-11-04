from datetime import datetime, timezone

import pytest

from app import autopsy, builds, config, limits, main, service, store
from app.errors import ApiException
from tests.conftest import FakeConditionalError
from tests.helpers import make_autopsy, make_record


class FakeCounters:
    def __init__(self):
        self.items = {}
        self.calls = []

    def update_item(self, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames,
                    ExpressionAttributeValues):
        assert "ADD #count :one" in UpdateExpression and "#ttl" in UpdateExpression
        assert "#count" in ExpressionAttributeNames and "#ttl" in ExpressionAttributeNames
        self.calls.append(Key["pk"])
        item = self.items.setdefault(Key["pk"], {})
        if item.get("count", 0) >= ExpressionAttributeValues[":limit"] and "count" in item:
            raise FakeConditionalError()
        item["count"] = item.get("count", 0) + 1
        item["ttl"] = ExpressionAttributeValues[":ttl"]


@pytest.fixture
def counters(monkeypatch):
    c = FakeCounters()
    monkeypatch.setattr(limits, "_table", lambda: c)
    monkeypatch.setattr(limits, "_admin_secret", lambda: "s3cret")
    monkeypatch.setattr(limits, "_now", lambda: datetime(2026, 11, 4, 7, 15, 0, tzinfo=timezone.utc))
    return c


def test_fourth_request_in_an_hour_is_limited(counters):
    for _ in range(3):
        limits.check("1.2.3.4", None)
    with pytest.raises(ApiException) as e:
        limits.check("1.2.3.4", None)
    assert e.value.code == "rate_limited" and e.value.status == 429
    assert e.value.retry_after_s == 45 * 60
    assert e.value.body()["error"].keys() == {"code", "message", "retry_after_s"}
    limits.check("5.6.7.8", None)  # another IP is fine
    pk = counters.calls[0]
    assert pk.startswith("ip#") and pk.endswith("#2026110407") and "1.2.3.4" not in pk
    assert counters.items[pk]["ttl"] == int(datetime(2026, 11, 4, 9, 15, tzinfo=timezone.utc).timestamp())


def test_new_hour_resets(counters, monkeypatch):
    for _ in range(3):
        limits.check("1.2.3.4", None)
    monkeypatch.setattr(limits, "_now", lambda: datetime(2026, 11, 4, 8, 0, 1, tzinfo=timezone.utc))
    limits.check("1.2.3.4", None)


def test_admin_bypasses_limits_wrong_admin_does_not(counters):
    for _ in range(3):
        limits.check("1.2.3.4", None)
    limits.check("1.2.3.4", "s3cret")
    limits.reserve_build("s3cret")
    with pytest.raises(ApiException):
        limits.check("1.2.3.4", "wrong")
    with pytest.raises(ApiException):
        limits.check("1.2.3.4", "")
    assert not any(k.startswith("quota#") for k in counters.calls)


def test_missing_admin_secret_never_matches(monkeypatch):
    monkeypatch.setattr(limits, "_admin_secret", lambda: None)
    assert limits.is_admin("anything") is False


def test_quota_51st_build_rejected(counters):
    for _ in range(50):
        limits.reserve_build(None)
    with pytest.raises(ApiException) as e:
        limits.reserve_build(None)
    assert e.value.code == "quota_exhausted" and e.value.retry_after_s == (24 - 7) * 3600 - 15 * 60
    assert "quota#2026-11-04" in counters.items


# ---- wiring through service ---------------------------------------------------------

@pytest.fixture
def flow(counters, table, monkeypatch):
    started = []
    monkeypatch.setattr(builds, "start", lambda *a: started.append(a) or "resurrect-build:1")

    def fake(blocked):
        from app.models import RepoRef
        a = make_autopsy(verdict="blocked" if blocked else "healthy",
                         stack="python" if blocked else "react-vite")
        res = autopsy.AutopsyResult(a, RepoRef(owner="o", name="n", url="https://github.com/o/n",
                                               default_branch="main", commit_sha="abc"), None)
        monkeypatch.setattr(autopsy, "run", lambda parsed: res)
    return started, fake


def test_cannot_rise_does_not_touch_quota(flow, counters):
    started, fake = flow
    fake(True)
    rec = service.create("https://github.com/o/n", "9.9.9.9", None)
    assert rec.res.status == "cannot_rise" and started == []
    assert not any(k.startswith("quota#") for k in counters.calls)
    assert any(k.startswith("ip#") for k in counters.calls)  # the IP limit still counts it


def test_build_counts_quota_and_exhaustion_blocks_before_start(flow, counters):
    started, fake = flow
    fake(False)
    service.create("https://github.com/o/n", "9.9.9.9", None)
    assert counters.items["quota#2026-11-04"]["count"] == 1 and len(started) == 1
    counters.items["quota#2026-11-04"]["count"] = 50
    with pytest.raises(ApiException) as e:
        service.create("https://github.com/o/n", "8.8.8.8", None)
    assert e.value.code == "quota_exhausted" and len(started) == 1


def test_kill_switch_beats_admin(flow, monkeypatch):
    started, fake = flow
    fake(False)
    monkeypatch.setenv("RESURRECTIONS_ENABLED", "false")
    with pytest.raises(ApiException) as e:
        service.create("https://github.com/o/n", "1.1.1.1", "s3cret")
    assert e.value.code == "resurrections_disabled" and e.value.status == 503 and started == []


def test_retry_counts_ip_and_quota(flow, counters):
    started, fake = flow
    fake(False)
    rec = make_record("failed")
    store.create(rec)
    service.retry("r-abc123", "7.7.7.7", None)
    assert any(k.startswith("ip#") for k in counters.calls) and "quota#2026-11-04" in counters.items
