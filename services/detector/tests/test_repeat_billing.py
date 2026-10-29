"""REPEAT_BILLING detector — pure tests (no DB).

Recall + precision come from the Prompt 04 synthetic manifest: the ONLY episodes flagged must be exactly the
planted ``fraud_repeat_billing`` ones (the 4 ``exception_repeatable_procedure`` episodes — repeatable codes
across days — and every clean episode must stay clean). Hand-built fixtures then pin the individual rule
branches the manifest doesn't cover (resubmission history, cancelled twin, mixed, within-claim repeat).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from _bundle import load_episodes, load_labels, require_bundle

from detector.config import Config
from detector.models import ClaimLineView, ClaimVersionView, DetectorType, Episode, Severity
from detector.repeat_billing import detect_repeat_billing


def _cfg(**kwargs) -> Config:
    return Config(
        app_database_url="unused", poll_interval_s=0.01, max_attempts=5, log_level="info",
        worker_id="test", **kwargs,
    )


def _claim(claim_no, codes, *, day=1, version=1, status="ACTIVE", is_current=True, cid=None) -> ClaimVersionView:
    return ClaimVersionView(
        id=cid or f"{claim_no}-v{version}",
        version=version,
        claim_no=claim_no,
        inacbg_code="X-1-01-0",
        amount=Decimal("1000.00"),
        content_hash="",
        fingerprint=None,
        status=status,
        is_current=is_current,
        submitted_at=datetime(2026, 3, day, 10, 0, tzinfo=timezone.utc),
        lines=[ClaimLineView(type="PROCEDURE", code=c, sequence=i + 1, description=None, amount=None)
               for i, c in enumerate(codes)],
    )


def _episode(claims) -> Episode:
    return Episode(
        id="ep-x", patient_token="patient:x", facility_id="F",
        started_at=datetime(2026, 3, 1, tzinfo=timezone.utc), ended_at=None, import_batch_id=None,
        claims=claims, evidence=[], links=[],
    )


# --- Manifest-driven recall + precision ---------------------------------------------------------


def test_flags_exactly_the_planted_repeat_billing_episodes() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    flagged = {ref for ref, ep in episodes.items() if detect_repeat_billing(ep, cfg)}
    expected = {ref for ref, lbl in labels.items() if lbl.get("category") == "fraud_repeat_billing"}

    assert expected, "manifest should contain planted fraud_repeat_billing episodes"
    assert flagged == expected  # recall on the 4 planted, zero false positives (clean + repeatable exceptions)


def test_planted_findings_are_well_formed() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    for ref, lbl in labels.items():
        if lbl.get("category") != "fraud_repeat_billing":
            continue
        findings = detect_repeat_billing(episodes[ref], cfg)
        assert len(findings) == 1
        f = findings[0]
        assert f.detector is DetectorType.REPEAT_BILLING
        assert f.severity is Severity.HIGH and f.score == 1.0
        assert f.reasons["detail"]["code"] in {"47.09", "51.23"}
        assert f.reasons["detail"]["count"] == 2
        assert f.reasons["messages"]  # a human-readable trigger is always present
        assert f.dedupe_key  # deterministic identity for ON CONFLICT


def test_repeatable_procedure_exceptions_are_not_flagged() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    for ref, lbl in labels.items():
        if lbl.get("category") == "exception_repeatable_procedure":
            assert detect_repeat_billing(episodes[ref], cfg) == []


# --- Rule-branch unit fixtures (not in the manifest) --------------------------------------------


def test_resubmission_history_is_not_fraud() -> None:
    # Two versions of ONE claim (same claimNo) = a resubmission, not a second billing.
    episode = _episode([_claim("C1", ["47.09"], version=1, is_current=False),
                         _claim("C1", ["47.09"], version=2, is_current=True)])
    assert detect_repeat_billing(episode, _cfg()) == []


def test_cancelled_duplicate_is_not_flagged() -> None:
    # A cancelled twin leaves only one active billing → no duplicate.
    episode = _episode([_claim("C1", ["47.09"]), _claim("C2", ["47.09"], status="CANCELLED")])
    assert detect_repeat_billing(episode, _cfg()) == []


def test_mixed_flags_only_the_non_repeatable_duplicate() -> None:
    # Repeatable dialysis (39.95) billed twice is legitimate; appendectomy (47.09) twice is not.
    episode = _episode([
        _claim("C1", ["47.09"]), _claim("C2", ["47.09"]),
        _claim("C3", ["39.95"]), _claim("C4", ["39.95"]),
    ])
    findings = detect_repeat_billing(episode, _cfg())
    assert len(findings) == 1
    assert findings[0].reasons["detail"]["code"] == "47.09"


def test_same_code_twice_on_one_claim_is_not_a_duplicate() -> None:
    # One claim listing the procedure twice is one billing, not two.
    episode = _episode([_claim("C1", ["47.09", "47.09"])])
    assert detect_repeat_billing(episode, _cfg()) == []


def test_dedupe_key_is_separator_safe_across_claim_numbers() -> None:
    # claimNo is unconstrained, so a delimiter-joined key could collide: ("B|C","D") and ("B","C|D") both
    # flatten to "47.09|B|C|D". The canonical-JSON key must keep these two distinct findings distinct, else
    # ON CONFLICT would silently drop a genuine fraud finding.
    cfg = _cfg()
    a = detect_repeat_billing(_episode([_claim("B|C", ["47.09"]), _claim("D", ["47.09"])]), cfg)
    b = detect_repeat_billing(_episode([_claim("B", ["47.09"]), _claim("C|D", ["47.09"])]), cfg)
    assert len(a) == 1 and len(b) == 1
    assert a[0].dedupe_key != b[0].dedupe_key


def test_explicitly_empty_exception_set_flags_dialysis() -> None:
    # Operator opt-out: an empty exception set means even repeatable codes are flagged when duplicated.
    episode = _episode([_claim("C1", ["39.95"]), _claim("C2", ["39.95"])])
    assert detect_repeat_billing(episode, _cfg(repeat_exception_codes=frozenset())) != []
