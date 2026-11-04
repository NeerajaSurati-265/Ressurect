"""Thin wrapper over the Bedrock Converse API that returns one JSON object or None."""
from __future__ import annotations

import json
import logging
from typing import Optional

from . import config

logger = logging.getLogger(__name__)


def extract_json(text: str) -> Optional[dict]:
    """First JSON object in text, which may be wrapped in prose or code fences."""
    if not text:
        return None
    decoder = json.JSONDecoder()
    pos = text.find("{")
    while pos != -1:
        try:
            obj, _ = decoder.raw_decode(text, pos)
        except ValueError:
            pos = text.find("{", pos + 1)
            continue
        if isinstance(obj, dict):
            return obj
        pos = text.find("{", pos + 1)
    return None


_clients = {}


def _runtime(timeout_s: float):
    if timeout_s not in _clients:
        import boto3
        from botocore.config import Config

        _clients[timeout_s] = boto3.client(
            "bedrock-runtime", region_name=config.REGION,
            config=Config(read_timeout=timeout_s, connect_timeout=2, retries={"max_attempts": 1}))
    return _clients[timeout_s]


def converse_json(system: str, user: str, max_tokens: int = 500, timeout_s: float = 8) -> Optional[dict]:
    model = config.settings().bedrock_model_id
    if not model:
        logger.warning("bedrock: BEDROCK_MODEL_ID is not set")
        return None
    try:
        resp = _runtime(timeout_s).converse(
            modelId=model,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
        )
        parts = resp["output"]["message"]["content"]
        text = "".join(p.get("text", "") for p in parts)
    except Exception as exc:
        logger.warning("bedrock: converse failed: %s: %s", type(exc).__name__, exc)
        return None
    obj = extract_json(text)
    if obj is None:
        logger.warning("bedrock: reply had no JSON object (%d chars)", len(text))
    return obj
