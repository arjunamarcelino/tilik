"""Cross-language golden-vector check — proves Python patientToken == the API's.

Reads the SAME committed fixture the API asserts (``test-vectors/tokenization.vectors.json`` at the repo
root, via ``pnpm --filter @tilik/api test:vectors``), so drift on either side is caught. Pure: no DB, no
real secret (the fixture carries its own non-production ``hmacKey``).
"""

from __future__ import annotations

import json
from pathlib import Path

from detector.tokenizer import patient_token

# services/detector/tests/ -> repo root -> test-vectors/
_FIXTURE = Path(__file__).resolve().parents[3] / "test-vectors" / "tokenization.vectors.json"


def _load() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_fixture_exists() -> None:
    assert _FIXTURE.is_file(), f"golden fixture missing at {_FIXTURE}"


def test_patient_token_matches_every_vector() -> None:
    vectors = _load()
    key = vectors["hmacKey"]
    cases = vectors["patientTokens"]
    assert cases, "fixture has no patientTokens vectors"
    for case in cases:
        assert patient_token(case["patientRef"], key) == case["expected"], (
            f"patient_token({case['patientRef']!r}) drifted from the golden vector"
        )


def test_normalization_trim_and_upper_collapse_to_same_token() -> None:
    vectors = _load()
    key = vectors["hmacKey"]
    # "SYN-PATIENT-0001" and "  syn-patient-0001  " must produce the identical token (NFC -> strip -> upper).
    assert patient_token("SYN-PATIENT-0001", key) == patient_token("  syn-patient-0001  ", key)
