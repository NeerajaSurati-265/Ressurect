import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app import config, expiry, reaper, store
from tests.helpers import make_record


class Err(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeScheduler:
    def __init__(self, create_exc=None):
        self.created, self.deleted, self.create_exc = [], [], create_exc

    def create_schedule(self, **kw):
        if self.create_exc:
            raise self.create_exc
        self.created.append(kw)

    def delete_schedule(self, **kw):
        if getattr(self, "missing", False):
            raise Err("ResourceNotFoundException")
        self.deleted.append(kw)


class FakeS3:
    PAGE = 1000

    def __init__(self, keys):
        self.keys = sorted(keys)
        self.delete_calls = []

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        # Like real S3, the continuation token is key-based, so deleting while paging is safe.
        matching = [k for k in self.keys if k.startswith(Prefix) and (not ContinuationToken or k > ContinuationToken)]
        page = matching[:self.PAGE]
        out = {"Contents": [{"Key": k} for k in page], "IsTruncated": len(matching) > self.PAGE}
        if out["IsTruncated"]:
            out["NextContinuationToken"] = page[-1]
        return out

    def delete_objects(self, Bucket, Delete):
        objs = Delete["Objects"]
        assert len(objs) <= 1000
        self.delete_calls.append(len(objs))
        gone = {o["Key"] for o in objs}
        self.keys = [k for k in self.keys if k not in gone]
        return {}


class FakeCloudFront:
    def __init__(self):
        self.calls = []

    def create_invalidation(self, DistributionId, InvalidationBatch):
        self.calls.append((DistributionId, InvalidationBatch))
        return {"Invalidation": {"Id": "I%d" % len(self.calls)}}


def wire(monkeypatch, **clients):
    monkeypatch.setattr(config, "client", lambda name: clients[name])


# ---- expiry -------------------------------------------------------------------------

@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("REAPER_ARN", "arn:aws:lambda:us-east-1:1:function:resurrect-reaper")
    monkeypatch.setenv("SCHEDULER_ROLE_ARN", "arn:aws:iam::1:role/resurrect-scheduler")
    monkeypatch.setenv("SCHEDULE_GROUP", "resurrect")
    monkeypatch.setenv("GRAVES_DISTRIBUTION_ID", "DIST1")


def alive(**kw):
    return make_record("alive", expires_at="2026-11-04T07:52:41Z", **kw)


def test_schedule_parameters(monkeypatch, env):
    sch = FakeScheduler()
    wire(monkeypatch, scheduler=sch)
    expiry.schedule(alive().res)
    kw = sch.created[0]
    assert kw["Name"] == "reap-r-abc123" and kw["GroupName"] == "resurrect"
    assert kw["ScheduleExpression"] == "at(2026-11-04T07:52:41)"
    assert kw["ScheduleExpressionTimezone"] == "UTC" and kw["FlexibleTimeWindow"] == {"Mode": "OFF"}
    assert kw["ActionAfterCompletion"] == "DELETE"
    assert kw["Target"]["Arn"].endswith("resurrect-reaper") and kw["Target"]["RoleArn"].endswith("resurrect-scheduler")
    assert json.loads(kw["Target"]["Input"]) == {"id": "r-abc123"}


def test_schedule_skips_pinned_and_swallows_errors(monkeypatch, env):
    sch = FakeScheduler()
    wire(monkeypatch, scheduler=sch)
    expiry.schedule(alive(pinned=True).res)
    assert sch.created == []
    for code in ("ConflictException", "AccessDeniedException"):
        wire(monkeypatch, scheduler=FakeScheduler(create_exc=Err(code)))
        expiry.schedule(alive().res)  # must not raise


def test_cancel_ignores_not_found(monkeypatch, env):
    sch = FakeScheduler()
    wire(monkeypatch, scheduler=sch)
    expiry.cancel("r-abc123")
    assert sch.deleted == [{"Name": "reap-r-abc123", "GroupName": "resurrect"}]
    sch.missing = True
    expiry.cancel("r-abc123")


# ---- reaper -------------------------------------------------------------------------

def keys_for(res_id, n):
    return ["graves/%s/f%04d.js" % (res_id, i) for i in range(n)]


def test_reaper_deletes_paginates_invalidates_and_expires(monkeypatch, env, table):
    store.create(alive())
    s3 = FakeS3(keys_for("r-abc123", 2500) + keys_for("r-other1", 3) + ["graves/_rip/index.html"])
    cf = FakeCloudFront()
    wire(monkeypatch, s3=s3, cloudfront=cf)
    out = reaper.handler({"id": "r-abc123"}, None)
    assert out["deleted"] == 2500 and out["result"] == "expired"
    assert s3.delete_calls == [1000, 1000, 500]
    assert len(s3.keys) == 4  # neighbours untouched
    dist, batch = cf.calls[0]
    assert dist == "DIST1" and batch["Paths"]["Items"] == ["/r-abc123/*"] and batch["CallerReference"]
    rec = store.get("r-abc123")
    assert rec.res.status == "expired" and rec.version == 2


def test_reaper_skips_pinned(monkeypatch, env, table):
    store.create(alive(pinned=True))
    s3, cf = FakeS3(keys_for("r-abc123", 5)), FakeCloudFront()
    wire(monkeypatch, s3=s3, cloudfront=cf)
    out = reaper.handler({"id": "r-abc123"}, None)
    assert out["result"] == "pinned_skipped" and len(s3.keys) == 5 and cf.calls == []
    assert store.get("r-abc123").res.status == "alive"


def test_reaper_is_idempotent(monkeypatch, env, table):
    store.create(alive())
    s3, cf = FakeS3(keys_for("r-abc123", 7)), FakeCloudFront()
    wire(monkeypatch, s3=s3, cloudfront=cf)
    reaper.handler({"id": "r-abc123"}, None)
    out = reaper.handler({"id": "r-abc123"}, None)
    assert out == {"ok": True, "id": "r-abc123", "result": "already", "deleted": 0}
    assert store.get("r-abc123").version == 2  # not bumped again


def test_reaper_unknown_record_still_cleans_and_bad_ids_rejected(monkeypatch, env, table):
    s3, cf = FakeS3(keys_for("r-ghost1", 2) + ["graves/_rip/index.html"]), FakeCloudFront()
    wire(monkeypatch, s3=s3, cloudfront=cf)
    assert reaper.handler({"id": "r-ghost1"}, None)["result"] == "missing"
    assert s3.keys == ["graves/_rip/index.html"]
    for bad in ({}, {"id": ""}, {"id": "_rip"}, {"id": "../ui"}, {"id": "r-*"}):
        assert reaper.handler(bad, None)["ok"] is False
    assert len(cf.calls) == 1


def test_reaper_logs_one_json_line(monkeypatch, env, table, caplog):
    store.create(alive())
    wire(monkeypatch, s3=FakeS3(keys_for("r-abc123", 1)), cloudfront=FakeCloudFront())
    with caplog.at_level("INFO"):
        reaper.handler({"id": "r-abc123"}, None)
    lines = [json.loads(r.message) for r in caplog.records if r.message.startswith("{")]
    assert lines[-1]["event"] == "reaper" and lines[-1]["deleted"] == 1


# ---- pin script ---------------------------------------------------------------------

def load_pin():
    spec = importlib.util.spec_from_file_location("pin", Path(__file__).resolve().parents[2] / "scripts" / "pin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Recorder:
    def __init__(self):
        self.calls = []

    def schedule(self, res):
        self.calls.append(("schedule", res.id, res.expires_at))

    def cancel(self, rid):
        self.calls.append(("cancel", rid))


NOW = datetime(2026, 11, 4, 8, 0, 0, tzinfo=timezone.utc)


def test_pin_and_unpin(table):
    pin, rec = load_pin(), Recorder()
    store.create(alive())
    assert pin.apply("r-abc123", False, store, rec, NOW) == {"id": "r-abc123", "pinned": True, "expires_at": None}
    s = store.get("r-abc123").res
    assert s.pinned and s.expires_at is None and rec.calls == [("cancel", "r-abc123")]
    out = pin.apply("r-abc123", True, store, rec, NOW)
    assert out["expires_at"] == "2026-11-04T08:20:00Z" and not out["pinned"]
    assert rec.calls[-1] == ("schedule", "r-abc123", "2026-11-04T08:20:00Z")


def test_pin_refuses_non_alive_and_unknown(table):
    pin = load_pin()
    store.create(make_record("failed"))
    with pytest.raises(SystemExit):
        pin.apply("r-abc123", False, store, Recorder(), NOW)
    with pytest.raises(SystemExit):
        pin.apply("r-nope00", False, store, Recorder(), NOW)


def test_pin_outputs_loader(tmp_path):
    pin = load_pin()
    p = tmp_path / "o.json"
    p.write_text(json.dumps({"table_name": {"value": "t", "type": "string", "sensitive": False}}))
    assert pin.load_outputs(p) == {"table_name": "t"}
