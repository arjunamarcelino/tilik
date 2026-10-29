"""REPEAT_BILLING detector — deterministic, explainable, no ML.

Signal: the same *non-repeatable* procedure billed on two or more DISTINCT claims for one patient on the
SAME calendar day (within one episode — the generator plants two separate claims, same patient, same day,
same surgical procedure). Transparent by construction so a reviewer can act on it.

Exceptions (never flagged), config-driven via ``cfg.repeat_exception_codes`` (default hemodialysis ``39.95``
+ chemotherapy ``99.25``): legitimately repeatable procedures. Removed from consideration BEFORE counting,
so a mixed episode (repeatable dialysis + a duplicated appendectomy) flags only the appendectomy.

Why same-day only (no multi-day window): a non-repeatable procedure legitimately re-billed on a *different*
day (re-operation, complication) is a valid case that must not flag — a window would fight the precision
gate. Same-day duplication of a one-time procedure is the unambiguous signal, so score is a fixed 1.0 / HIGH.

Determinism: codes are emitted in sorted order (set iteration is PYTHONHASHSEED-sensitive) and the dedupe
key is order-independent, so a retried job produces identical findings.
"""

from __future__ import annotations

import hashlib
import json

from .config import Config
from .models import ClaimVersionView, DetectorType, Episode, FindingDraft, Severity

# Human labels for readable Indonesian reasons; unknown codes fall back to the bare code.
_PROC_LABELS = {"47.09": "Apendektomi", "51.23": "Kolesistektomi laparoskopi"}
_INACTIVE = {"CANCELLED", "ENTERED_IN_ERROR"}  # a cancelled / error-marked duplicate is not fraud
_SCORE = 1.0  # an exact same-day duplicate of a one-time procedure is unambiguous


def detect_repeat_billing(episode: Episode, cfg: Config) -> list[FindingDraft]:
    """Return a REPEAT_BILLING finding per non-repeatable procedure duplicated across claims on one day."""
    active = [c for c in episode.claims if c.status not in _INACTIVE]
    representatives = _representatives(active)

    # code -> day(ISO str) -> {claim_no: claim_version_id}. The inner dict keys on claim_no, so a procedure
    # listed twice on ONE claim counts once (one billing), and distinct claims collide into a count >= 2.
    by_code_day: dict[str, dict[str, dict[str, str]]] = {}
    for claim in representatives:
        # submittedAt is NOT NULL in the schema (ClaimVersion.submittedAt: DateTime), so there is no dateless
        # bucket to accidentally co-group distinct claims into — the "same calendar day" key is always real.
        day = claim.submitted_at.date().isoformat()
        procedure_codes = {ln.code for ln in claim.lines if ln.type == "PROCEDURE"}
        for code in procedure_codes:
            if code in cfg.repeat_exception_codes:
                continue
            by_code_day.setdefault(code, {}).setdefault(day, {})[claim.claim_no] = claim.id

    findings: list[FindingDraft] = []
    for code in sorted(by_code_day):  # sorted → stable emission order regardless of PYTHONHASHSEED
        for day in sorted(by_code_day[code]):
            claims_on_day = by_code_day[code][day]
            if len(claims_on_day) < 2:
                continue
            findings.append(_build_finding(episode, code, day, claims_on_day))
    return findings


def _build_finding(episode: Episode, code: str, day: str, claims_on_day: dict[str, str]) -> FindingDraft:
    claim_nos = sorted(claims_on_day)
    claim_version_ids = set(claims_on_day.values())
    label = _PROC_LABELS.get(code, code)
    message = (
        f"Prosedur {code} ({label}) ditagih {len(claim_nos)}x untuk pasien yang sama "
        f"pada hari yang sama ({day})."
    )
    reasons = {
        "messages": [message],
        "detail": {"code": code, "claimNos": claim_nos, "day": day, "count": len(claim_nos)},
    }
    return FindingDraft(
        detector=DetectorType.REPEAT_BILLING,
        score=_SCORE,
        severity=Severity.HIGH,
        reasons=reasons,
        evidence_refs=_linked_evidence(episode, claim_version_ids),
        # Key off a canonical JSON array, not a delimiter-joined string: claimNo is an unconstrained string at
        # the import boundary, so a "|"-join could let two distinct duplicated billings collide and silently
        # drop one under ON CONFLICT (a fraud false-negative). JSON escaping makes the encoding injective. Key
        # excludes day/score so identity stays corpus-invariant; the claim_no set uniquely identifies it.
        dedupe_key=hashlib.sha256(
            json.dumps([code, claim_nos], separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).hexdigest(),
        claim_version_id=min(claim_version_ids),  # deterministic: the lowest-id duplicate
    )


def _representatives(claims: list[ClaimVersionView]) -> list[ClaimVersionView]:
    """One representative per ``claim_no`` — prefer ``is_current``, else the highest ``version``. Two versions
    of the SAME claim are a resubmission, not a second billing."""
    by_claim_no: dict[str, ClaimVersionView] = {}
    for claim in claims:
        incumbent = by_claim_no.get(claim.claim_no)
        if incumbent is None or _supersedes(claim, incumbent):
            by_claim_no[claim.claim_no] = claim
    return list(by_claim_no.values())


def _supersedes(candidate: ClaimVersionView, incumbent: ClaimVersionView) -> bool:
    if candidate.is_current != incumbent.is_current:
        return candidate.is_current
    return candidate.version > incumbent.version


def _linked_evidence(episode: Episode, claim_version_ids: set[str]) -> list[str]:
    """EvidenceRecord ids linked to any of the duplicated claims (sorted). ``evidenceRefs`` is contractually
    EvidenceRecord ids — claim identifiers live in ``reasons`` instead."""
    return sorted({ln.evidence_id for ln in episode.links if ln.claim_version_id in claim_version_ids})
