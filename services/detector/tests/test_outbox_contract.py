"""Pin the DETECT_EPISODE outbox contract to the shared fixture (pure — no DB).

The API enqueues the job type / payload shape; this worker polls for them. A rename on either side is a
silent stall (the worker would poll for a type never enqueued), so both the TS side (apps/api test:contract)
and this test assert against ``test-vectors/outbox-contract.json`` — drift anywhere trips a test.
"""

from __future__ import annotations

import json
from pathlib import Path

from detector import repository
from detector.worker import validate_payload

_VECTORS = Path(__file__).resolve().parents[3] / "test-vectors"
_FIXTURE = _VECTORS / "outbox-contract.json"
_AUDIT_FIXTURE = _VECTORS / "audit-contract.json"


def _contract() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_job_type_matches_contract() -> None:
    assert repository.DETECT_EPISODE == _contract()["jobType"]


def test_payload_shape_matches_contract() -> None:
    payload = _contract()["payload"]
    assert payload["v"] == 1
    assert set(payload["keys"]) == {"v", "episodeId", "importBatchId"}
    # A payload carrying the contract keys validates and yields the opaque episodeId.
    sample = {"v": payload["v"], "episodeId": "ep-contract", "importBatchId": "batch-contract"}
    assert validate_payload(sample) == "ep-contract"


def test_detect_audit_action_matches_contract() -> None:
    # The detector writes AUDIT_ACTION_DETECT; the API/case-audit UI (Prompt 11) reads it. A rename on
    # either side would silently mislabel the audit timeline, so the string is pinned both sides against
    # test-vectors/audit-contract.json (TS half: apps/api test:contract).
    actions = json.loads(_AUDIT_FIXTURE.read_text(encoding="utf-8"))["actions"]
    # Pin the whole action set the detector mirrors (not just the DETECT value), so a new boundary-crossing
    # action added to the fixture forces a matching Python mirror here instead of silently drifting.
    assert set(actions) == {"DETECT"}
    assert actions["DETECT"] == repository.AUDIT_ACTION_DETECT
