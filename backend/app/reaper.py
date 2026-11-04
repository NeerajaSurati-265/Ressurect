"""Placeholder reaper. B2 replaces this with the real cleanup."""
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    logger.info("reaper placeholder received event: %s", json.dumps(event))
    return {"ok": True, "placeholder": True}
