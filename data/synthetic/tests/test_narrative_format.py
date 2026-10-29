"""The narrative boilerplate-line format is a contract consumed by services/detector.

cloning.strip_boilerplate strips the disclaimer + identity lines before TF-IDF, keying on the prefixes in
test-vectors/narrative-format.json. Assert here (generator side) that every emitted MEDICAL_RECORD narrative
actually leads with those two lines, so a narrative edit that moves/renames them fails CI instead of silently
degrading the detector. The detector side asserts the same vector.
"""

import json
from pathlib import Path

from tilik_synth.cli import main

_VECTORS = Path(__file__).resolve().parents[3] / "test-vectors" / "narrative-format.json"


def test_every_narrative_leads_with_the_contracted_boilerplate_lines(tmp_path):
    contract = json.loads(_VECTORS.read_text(encoding="utf-8"))
    disclaimer_prefix, identity_prefix = contract["disclaimerPrefix"], contract["identityPrefix"]

    out = tmp_path / "out"
    assert main(["--episodes", "60", "--seed-fraud", "--seed", "42", "--out", str(out), "--quiet"]) == 0
    evidence = json.loads((out / "evidence-records.json").read_text(encoding="utf-8"))

    narratives = [n for e in evidence if (n := (e.get("payload") or {}).get("narrative"))]
    assert narratives, "expected MEDICAL_RECORD narratives in the bundle"
    for narrative in narratives:
        lines = narrative.splitlines()
        assert lines[0].startswith(disclaimer_prefix), f"line 0 is not the disclaimer: {lines[0]!r}"
        assert lines[1].startswith(identity_prefix), f"line 1 is not the identity line: {lines[1]!r}"
