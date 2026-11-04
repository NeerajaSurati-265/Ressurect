#!/usr/bin/env python3
"""Pin (keep forever) or unpin a live resurrection.

Usage (from the repo root, with the backend venv that has boto3 and pydantic):
    backend/.venv/bin/python scripts/pin.py <id>            # pin: no expiry, schedule removed
    backend/.venv/bin/python scripts/pin.py <id> --unpin    # 20 minutes from now, schedule created
Settings come from infra/outputs.json (terraform output -json). Region is always us-east-1.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ENV = {
    "table_name": "TABLE_NAME",
    "reaper_arn": "REAPER_ARN",
    "scheduler_role_arn": "SCHEDULER_ROLE_ARN",
    "schedule_group": "SCHEDULE_GROUP",
    "graves_url": "GRAVES_URL",
}
LIFETIME_MINUTES = 20


def load_outputs(path: Path) -> dict:
    data = json.loads(path.read_text())
    return {k: (v["value"] if isinstance(v, dict) else v) for k, v in data.items()}


def apply(rec_id: str, unpin: bool, store, expiry, now) -> dict:
    """Mutate the stored record. Pure enough to unit-test with fakes."""
    for _ in range(3):
        rec = store.get(rec_id)
        if rec is None:
            raise SystemExit("No such resurrection: %s" % rec_id)
        r = rec.res
        if r.status != "alive":
            raise SystemExit("%s is %s; only alive records can be pinned or unpinned." % (rec_id, r.status))
        if unpin:
            r.pinned = False
            r.expires_at = (now + timedelta(minutes=LIFETIME_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            r.pinned = True
            r.expires_at = None
        try:
            store.save(rec)
        except store.ConflictError:
            continue
        if unpin:
            expiry.schedule(r)
        else:
            expiry.cancel(rec_id)
        return {"id": rec_id, "pinned": r.pinned, "expires_at": r.expires_at}
    raise SystemExit("The record kept changing; try again.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("id")
    ap.add_argument("--unpin", action="store_true")
    ap.add_argument("--outputs", default=str(ROOT / "infra" / "outputs.json"))
    args = ap.parse_args(argv)

    outputs = load_outputs(Path(args.outputs))
    for key, env in OUTPUT_ENV.items():
        if key not in outputs:
            raise SystemExit("infra/outputs.json lacks %r; regenerate with terraform output -json" % key)
        os.environ[env] = str(outputs[key])
    sys.path.insert(0, str(ROOT / "backend"))
    from app import expiry, store  # noqa: E402  (imported after the env is set)
    from app.timeutil import now_utc  # noqa: E402

    print(json.dumps(apply(args.id, args.unpin, store, expiry, now_utc())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
