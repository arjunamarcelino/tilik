"""Guard the hand-mirrored enum / relation / category strings against drift.

`data/synthetic` is not a workspace package, so it cannot import the @tilik/shared enums or the Prisma
relation CHECK at build time — drift would otherwise only surface late, at the Prompt-06 import endpoint.
These vendored sets snapshot the upstream values; both the config constants and every string the generator
actually emits must stay within them.
"""

import json

import pytest

from tilik_synth import config
from tilik_synth.cli import main

# Vendored from packages/shared/src/enums.ts and the EvidenceLink.relation CHECK in the init migration.
EVIDENCE_KINDS = {"MEDICAL_RECORD", "LAB", "IMAGING", "ATTACHMENT", "CLAIM"}
CLAIM_LINE_TYPES = {"DIAGNOSIS", "PROCEDURE"}
CLAIM_STATUSES = {"ACTIVE", "CANCELLED", "ENTERED_IN_ERROR"}
DETECTORS = {"REPEAT_BILLING", "CLONING", "PERTENTANGAN_BUKTI"}
RELATIONS = {"mendukung", "bertentangan", "sumber"}
CATEGORIES = {
    "clean",
    "fraud_repeat_billing",
    "fraud_cloning",
    "fraud_contradiction",
    "exception_repeatable_procedure",
    "exception_soap_template",
}


def test_config_constants_match_the_vendored_values():
    assert {config.MEDICAL_RECORD, config.LAB, config.IMAGING, config.ATTACHMENT} <= EVIDENCE_KINDS
    assert {config.DIAGNOSIS, config.PROCEDURE} == CLAIM_LINE_TYPES
    assert config.ACTIVE in CLAIM_STATUSES
    assert {config.REPEAT_BILLING, config.CLONING, config.PERTENTANGAN_BUKTI} == DETECTORS
    assert {config.REL_SUPPORT, config.REL_CONTRADICT, config.REL_SOURCE} == RELATIONS
    assert {
        config.CLEAN,
        config.FRAUD_REPEAT_BILLING,
        config.FRAUD_CLONING,
        config.FRAUD_CONTRADICTION,
        config.EXCEPTION_REPEATABLE,
        config.EXCEPTION_SOAP,
    } == CATEGORIES


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    out = tmp_path_factory.mktemp("bundle")
    assert main(["--episodes", "60", "--seed-fraud", "--seed", "42", "--out", str(out), "--quiet"]) == 0
    load = lambda name: json.loads((out / name).read_text(encoding="utf-8"))
    return {
        "claims": load("claim-versions.json"),
        "evidence": load("evidence-records.json"),
        "links": load("evidence-links.json"),
        "manifest": load("manifest.json"),
    }


def test_emitted_strings_are_within_the_vendored_sets(bundle):
    assert {e["kind"] for e in bundle["evidence"]} <= EVIDENCE_KINDS
    assert {ln["relation"] for ln in bundle["links"]} <= RELATIONS
    assert {c["status"] for c in bundle["claims"]} <= CLAIM_STATUSES
    assert {ln["type"] for c in bundle["claims"] for ln in c["lines"]} <= CLAIM_LINE_TYPES
    labels = bundle["manifest"]["labels"].values()
    assert {lab["category"] for lab in labels} <= CATEGORIES
    assert {lab["detector"] for lab in labels if "detector" in lab} <= DETECTORS
