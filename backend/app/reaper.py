"""Reaper Lambda: delete a site's files, clear the CDN cache and mark the record expired."""
from __future__ import annotations

import json
import logging
import re
import time
import uuid

from . import config, functions, store

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ID_RE = re.compile(r"^r-[a-z0-9]{6}$")
MAX_SAVE_TRIES = 3


def _delete_prefix(prefix: str) -> int:
    s3 = config.client("s3")
    bucket = config.settings().bucket
    deleted = 0
    token = None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        page = s3.list_objects_v2(**kw)
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            resp = s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
            if resp.get("Errors"):
                raise RuntimeError("S3 delete errors: %s" % resp["Errors"][:3])
            deleted += len(batch)
        if not page.get("IsTruncated"):
            return deleted
        token = page.get("NextContinuationToken")


def _invalidate(res_id: str) -> str:
    resp = config.client("cloudfront").create_invalidation(
        DistributionId=config.settings().graves_distribution_id,
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/%s/*" % res_id]},
                           "CallerReference": "reap-%s-%s" % (res_id, uuid.uuid4().hex)})
    return resp["Invalidation"]["Id"]


def _mark_expired(res_id: str) -> str:
    """Returns 'expired', 'already', 'pinned', 'missing' or 'skipped'."""
    for _ in range(MAX_SAVE_TRIES):
        rec = store.get(res_id)
        if rec is None:
            return "missing"
        if rec.res.pinned:
            return "pinned"
        if rec.res.status != "alive":
            return "already" if rec.res.status == "expired" else "skipped"
        rec.res.status = "expired"
        rec.res.phase_message = "Returned to the grave"
        try:
            store.save(rec)
            return "expired"
        except store.ConflictError:
            continue
    raise RuntimeError("could not save %s after %d tries" % (res_id, MAX_SAVE_TRIES))


def handler(event, context=None):
    res_id = (event or {}).get("id", "")
    started = time.time()
    if not ID_RE.match(str(res_id)):
        logger.error(json.dumps({"event": "reaper", "error": "bad id", "id": str(res_id)[:40]}))
        return {"ok": False, "error": "bad id"}

    rec = store.get(res_id)
    if rec is not None and rec.res.pinned:
        logger.info(json.dumps({"event": "reaper", "id": res_id, "result": "pinned_skipped", "deleted": 0}))
        return {"ok": True, "id": res_id, "result": "pinned_skipped"}

    deleted = _delete_prefix("graves/%s/" % res_id)
    invalidation = _invalidate(res_id)
    line = {}
    if rec is None or rec.backend is not None:  # backend apps: function (and URL), image, log group
        line["backend_cleanup"] = functions.cleanup(res_id)
    result = _mark_expired(res_id)
    logger.info(json.dumps({"event": "reaper", "id": res_id, "result": result, "deleted": deleted,
                            "invalidation": invalidation, "ms": int((time.time() - started) * 1000), **line}))
    return {"ok": True, "id": res_id, "result": result, "deleted": deleted}
