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

_FIXTURE = Path(__file__).resolve().parents[3] / "test-vectors" / "outbox-contract.json"


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
