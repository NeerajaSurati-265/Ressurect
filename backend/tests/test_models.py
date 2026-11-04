"""Models must match contracts/types.ts: same field names, same nullability, nulls kept."""
import json
import re
import typing
from pathlib import Path

from app import models

ROOT = Path(__file__).resolve().parents[2]
TS = (ROOT / "contracts" / "types.ts").read_text()
API_MD = (ROOT / "contracts" / "api.md").read_text()

INTERFACES = {
    "Finding": models.Finding,
    "Autopsy": models.Autopsy,
    "Ghost": models.Ghost,
    "RepoRef": models.RepoRef,
    "Pulse": models.Pulse,
    "Resurrection": models.Resurrection,
    "LogLine": models.LogLine,
    "LogsResponse": models.LogsResponse,
    "CreateResurrectionRequest": models.CreateResurrectionRequest,
}


def parse_interface(name):
    body = re.search(r"export interface %s \{(.*?)\n\}" % name, TS, re.S).group(1)
    fields = {}
    for line in body.splitlines():
        m = re.match(r"\s*(\w+): (.+?);", line)
        if m:
            fields[m.group(1)] = "| null" in m.group(2)
    return fields


def is_optional(annotation):
    return type(None) in typing.get_args(annotation)


def test_field_names_and_nullability_match_types_ts():
    for name, model in INTERFACES.items():
        ts_fields = parse_interface(name)
        assert ts_fields, name
        assert set(model.model_fields) == set(ts_fields), name
        for field, nullable in ts_fields.items():
            assert is_optional(model.model_fields[field].annotation) == nullable, f"{name}.{field}"


def test_api_error_envelope_matches():
    body = re.search(r"export interface ApiError \{(.*?)\n\}", TS, re.S).group(1)
    assert "error:" in body
    inner = re.search(r"error: \{(.*?)\}", body, re.S).group(1)
    assert set(models.ApiErrorBody.model_fields) == {"code", "message", "retry_after_s"}
    assert "retry_after_s: number | null" in inner


def test_literal_unions_match_types_ts():
    for ts_name, literal in [("ResurrectionStatus", models.ResurrectionStatus), ("Stack", models.Stack),
                             ("Severity", models.Severity)]:
        block = re.search(r"export type %s =(.*?);" % ts_name, TS, re.S).group(1)
        assert set(re.findall(r'"([^"]+)"', block)) == set(typing.get_args(literal))


def test_contract_example_roundtrips_exactly():
    example = json.loads(re.search(r"## Example.*?```json\n(.*?)```", API_MD, re.S).group(1))
    dumped = models.Resurrection.model_validate(example).model_dump(mode="json")
    assert dumped == example


def test_nulls_are_kept_not_omitted():
    example = json.loads(re.search(r"## Example.*?```json\n(.*?)```", API_MD, re.S).group(1))
    rec = models.StoredRecord(res=models.Resurrection.model_validate(example), build_id="b", version=3)
    out = rec.to_api("2026-11-04T07:32:43Z")
    assert "ghost" in out and out["ghost"] is None
    assert not {"build_id", "version", "log_stream", "pulse_lines", "client_ip"} & set(out)
    assert out["server_time"] == "2026-11-04T07:32:43Z"
