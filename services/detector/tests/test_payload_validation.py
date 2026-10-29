"""Pure tests for DETECT_EPISODE payload validation (no DB)."""

from __future__ import annotations

import pytest

from detector.worker import NonRetryableError, validate_payload


def test_valid_payload_returns_episode_id() -> None:
    payload = {"v": 1, "episodeId": "ep-abc-123", "importBatchId": "batch-1"}
    assert validate_payload(payload) == "ep-abc-123"


def test_episode_id_is_opaque_not_parsed() -> None:
    # Not a UUID/cuid — still accepted; the worker treats it as an opaque string.
    assert validate_payload({"v": 1, "episodeId": "not-a-uuid"}) == "not-a-uuid"


@pytest.mark.parametrize(
    "payload",
    [
        {"v": 2, "episodeId": "ep-1"},          # unknown version
        {"episodeId": "ep-1"},                   # missing version
        {"v": 1},                                 # missing episodeId
        {"v": 1, "episodeId": ""},               # empty episodeId
        {"v": 1, "episodeId": 123},              # non-string episodeId
        ["not", "an", "object"],                 # not a dict
        None,                                     # null payload
    ],
)
def test_bad_payloads_raise_non_retryable(payload) -> None:
    with pytest.raises(NonRetryableError):
        validate_payload(payload)
