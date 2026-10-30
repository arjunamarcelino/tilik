"""PERTENTANGAN_BUKTI detector — pure tests (no DB).

Recall + precision come from the Prompt 04 synthetic manifest: the ONLY episodes flagged must be exactly
the planted ``fraud_contradiction`` set PLUS the ``fraud_cloning`` set (a cloned appendectomy with no
operative docs is structurally also an evidence contradiction — defense in depth). Every ``clean`` /
exception / ``fraud_repeat_billing`` episode must stay clean. Hand-built fixtures then pin the individual
rule branches (late support, timely support, no anchor, cancelled, non-surgical, resubmission dedupe).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from _bundle import load_episodes, load_labels, require_bundle
from _helpers import detector_config as _cfg

from detector.models import (
    ClaimLineView,
    ClaimVersionView,
    DetectorType,
    Episode,
    EvidenceLinkView,
    EvidenceView,
    Severity,
)
from detector.pertentangan import _SURGICAL_PROCEDURE_CODES, detect_pertentangan

_CONTRADICTION = "fraud_contradiction"
_CLONING = "fraud_cloning"
_CLEAN_LIKE = {"clean", "exception_repeatable_procedure", "exception_soap_template", "fraud_repeat_billing"}


# --- fixture builders ---------------------------------------------------------------------------


def _claim(*, code="47.09", day=10, hour=10, version=1, status="ACTIVE", is_current=True, cid="cv-1", claim_no="C1"):
    return ClaimVersionView(
        id=cid, version=version, claim_no=claim_no, inacbg_code="X-1-01-0", amount=Decimal("9000000.00"),
        content_hash="", fingerprint=None, status=status, is_current=is_current,
        submitted_at=datetime(2026, 3, day, hour, 0, tzinfo=timezone.utc),
        lines=[ClaimLineView(type="PROCEDURE", code=code, sequence=1, description=None, amount=None)],
    )


def _ev(ev_id, *, kind="MEDICAL_RECORD", day=10, hour=9):
    return EvidenceView(
        id=ev_id, kind=kind, object_key=None, payload=None, content_hash="", fingerprint=None,
        captured_at=datetime(2026, 3, day, hour, 0, tzinfo=timezone.utc),
    )


def _episode(claims, evidence=(), links=()):
    return Episode(
        id="ep-x", patient_token="patient:x", facility_id="F",
        started_at=datetime(2026, 3, 1, tzinfo=timezone.utc), ended_at=None, import_batch_id=None,
        claims=list(claims), evidence=list(evidence), links=list(links),
    )


# --- Manifest-driven recall + precision ---------------------------------------------------------


def test_flags_exactly_contradiction_and_cloning_episodes() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    flagged = {ref for ref, ep in episodes.items() if detect_pertentangan(ep, cfg)}
    expected = {ref for ref, lbl in labels.items() if lbl.get("category") in {_CONTRADICTION, _CLONING}}

    assert expected, "manifest should contain planted fraud_contradiction + fraud_cloning episodes"
    assert flagged == expected  # recall on contradiction + cloning; zero on clean/exception/repeat-billing


def test_planted_contradictions_are_high_with_bertentangan_link() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    for ref, lbl in labels.items():
        if lbl.get("category") != _CONTRADICTION:
            continue
        findings = detect_pertentangan(episodes[ref], cfg)
        assert len(findings) == 1
        f = findings[0]
        assert f.detector is DetectorType.PERTENTANGAN_BUKTI
        assert f.severity is Severity.HIGH and f.score == 1.0
        assert f.reasons["detail"]["severityReason"] == "NO_SUPPORTING_DOC"
        assert f.reasons["detail"]["procedureCode"] in _SURGICAL_PROCEDURE_CODES
        assert f.reasons["messages"]
        assert f.dedupe_key
        assert len(f.evidence_links) == 1
        link = f.evidence_links[0]
        assert link.claim_version_id == f.claim_version_id
        assert link.evidence_id in f.evidence_refs


def test_clean_and_exception_families_are_not_flagged() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    for ref, lbl in labels.items():
        if lbl.get("category") in _CLEAN_LIKE:
            assert detect_pertentangan(episodes[ref], cfg) == [], f"{ref} ({lbl.get('category')}) must not flag"


def test_surgical_set_covers_planted_fraud_codes() -> None:
    # Fixture coupling: the detector's surgical set must track the generator's planted contradiction codes
    # (so the constant can't silently drift from the data it keys on).
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    planted = {
        ln.code
        for ref, lbl in labels.items() if lbl.get("category") == _CONTRADICTION
        for cv in episodes[ref].claims for ln in cv.lines if ln.type == "PROCEDURE"
    }
    assert planted and planted <= _SURGICAL_PROCEDURE_CODES


# --- Rule-branch unit fixtures (not in the manifest) --------------------------------------------


def test_surgical_claim_without_support_is_high() -> None:
    ep = _episode([_claim()], [_ev("ev-rec")], [EvidenceLinkView("ev-rec", "cv-1", "sumber", None)])
    out = detect_pertentangan(ep, _cfg())
    assert len(out) == 1 and out[0].severity is Severity.HIGH
    assert out[0].evidence_links[0].evidence_id == "ev-rec"


def test_surgical_claim_with_no_evidence_abstains() -> None:
    # The repeat-billing family: a surgical proc with zero evidence has nothing to contradict (no anchor).
    assert detect_pertentangan(_episode([_claim()]), _cfg()) == []


def test_timely_support_is_clean() -> None:
    # Support captured 09:00, claim submitted 10:00 → on time → no finding (the clean surgical case).
    ep = _episode(
        [_claim(hour=10)],
        [_ev("ev-op", kind="ATTACHMENT", hour=9)],
        [EvidenceLinkView("ev-op", "cv-1", "mendukung", None)],
    )
    assert detect_pertentangan(ep, _cfg()) == []


def test_late_support_is_medium() -> None:
    # Support captured 14:00, claim submitted 10:00 → all late → MEDIUM "needs more info", not HIGH.
    ep = _episode(
        [_claim(hour=10)],
        [_ev("ev-op", kind="ATTACHMENT", hour=14)],
        [EvidenceLinkView("ev-op", "cv-1", "mendukung", None)],
    )
    out = detect_pertentangan(ep, _cfg())
    assert len(out) == 1
    assert out[0].severity is Severity.MEDIUM and out[0].score == 0.5
    assert out[0].reasons["detail"]["severityReason"] == "LATE_OR_EXTERNAL_DOC"
    # The late case is a "needs more info" finding only — it must NOT write a bertentangan link onto a doc
    # that already `mendukung`-supports the claim (that would be a self-contradictory pair).
    assert out[0].evidence_links == ()


def test_non_surgical_procedure_is_ignored() -> None:
    ep = _episode([_claim(code="39.95")], [_ev("ev-rec")], [EvidenceLinkView("ev-rec", "cv-1", "sumber", None)])
    assert detect_pertentangan(ep, _cfg()) == []


def test_cancelled_claim_is_dropped() -> None:
    ep = _episode([_claim(status="CANCELLED")], [_ev("ev-rec")], [EvidenceLinkView("ev-rec", "cv-1", "sumber", None)])
    assert detect_pertentangan(ep, _cfg()) == []


def test_dedupe_key_stable_across_resubmission() -> None:
    # A resubmission collapses to a different representative version row, but the dedupe key is keyed on
    # claim_no — so the same logical contradiction keeps ONE stable identity (conflicts onto the first row).
    ev = _ev("ev-rec")
    ep_v1 = _episode(
        [_claim(cid="cv-1", version=1, is_current=True)], [ev],
        [EvidenceLinkView("ev-rec", "cv-1", "sumber", None)],
    )
    ep_v2 = _episode(
        [_claim(cid="cv-1", version=1, is_current=False), _claim(cid="cv-2", version=2, is_current=True)],
        [ev],
        [EvidenceLinkView("ev-rec", "cv-2", "sumber", None)],
    )
    a = detect_pertentangan(ep_v1, _cfg())
    b = detect_pertentangan(ep_v2, _cfg())
    assert len(a) == 1 and len(b) == 1
    assert a[0].dedupe_key == b[0].dedupe_key  # stable across the version bump
    assert a[0].claim_version_id == "cv-1" and b[0].claim_version_id == "cv-2"  # column tracks the examined version
