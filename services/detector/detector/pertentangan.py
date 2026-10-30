"""PERTENTANGAN_BUKTI detector — rule-based claim↔evidence contradiction (no ML).

Signal (the generator's ``fraud_contradiction`` family): a surgical/one-time procedure is billed but the
claim carries NO supporting (``mendukung``) evidence — the mandatory operative + anaesthesia reports are
absent. The clean surgical case attaches exactly those docs, so presence/absence of ``mendukung`` support
is the discriminator. On a HIGH contradiction the detector emits a Finding AND asks the worker to record a
``relation='bertentangan'`` EvidenceLink tying the source record to the offending claim version (the write
lives in the repository/worker — this stays a pure function, like the other two detectors).

Severity ladder (grounded in CMS CERT/TPE deny / pend / clear practice):
  * required support ABSENT                          → HIGH   (``NO_SUPPORTING_DOC``)  + a ``bertentangan`` link
  * support present but ALL captured AFTER the claim was submitted (administrative lag / external
    referral) → MEDIUM (``LATE_OR_EXTERNAL_DOC``) — a "needs more info" pend, not an outright denial
  * support present and at least one piece timely    → no finding (clean)

Only the HIGH (missing-doc) case records a ``bertentangan`` link: a late-but-present doc legitimately
SUPPORTS the claim (it already carries a ``mendukung`` link), so also tagging it ``bertentangan`` would
make one evidence record both support and contradict the same claim — a self-contradictory pair. The late
case stays a lower-severity "needs more info" finding with no link.

Anchor requirement: a contradiction needs a *source* record to tie the ``bertentangan`` link to. A claim
billing surgery with ZERO evidence (the repeat-billing family) has nothing to contradict — that is an
incompleteness problem caught by REPEAT_BILLING — so this detector abstains there (requires a ``sumber``
anchor), which also keeps precision crisp.

Scope: only the surgical-procedure rule is implemented. A diagnosis→lab/imaging rule is deliberately
deferred — on this data it would false-positive on every episode carrying a diagnosis but no lab
(repeat-billing, cloning, SOAP), wrecking the precision gate.

Determinism: findings are emitted in sorted ``(claim_version_id, code)`` order (set iteration is
PYTHONHASHSEED-sensitive), the ``bertentangan`` anchor is the lowest-id tie-break, and the dedupe key is
keyed on ``(claim_no, code)`` — stable across a resubmission (which collapses to a different version row),
mirroring ``repeat_billing``.
"""

from __future__ import annotations

import hashlib
import json

from .config import Config
from .models import (
    ClaimVersionView,
    DetectorType,
    Episode,
    EvidenceLinkDraft,
    EvidenceView,
    FindingDraft,
    Severity,
)

# Procedure codes that require operative/anaesthesia support. Fixture-coupled to the generator's
# SURGICAL_PROCEDURES (data/synthetic/tilik_synth/config.py) — a module constant, NOT env: changing it
# breaks recall rather than tuning precision, so it is not a demo-operator dial (cf. CLONING_MAX_DF).
_SURGICAL_PROCEDURE_CODES = frozenset({"47.09", "51.23"})
_PROC_LABELS = {"47.09": "Apendektomi", "51.23": "Kolesistektomi laparoskopi"}
_INACTIVE = {"CANCELLED", "ENTERED_IN_ERROR"}  # a cancelled / error-marked claim is not a live billing

_REL_SUPPORT = "mendukung"
_REL_SOURCE = "sumber"
# (the 'bertentangan' output relation is implicit — hard-coded in repository.insert_evidence_links)

_MISSING_SCORE = 1.0  # required support absent — an unsubstantiated surgical claim
_LATE_SCORE = 0.5  # support present but late/external — needs-more-info, not an outright denial

_REASON_MISSING = "NO_SUPPORTING_DOC"
_REASON_LATE = "LATE_OR_EXTERNAL_DOC"
_NOTE_MISSING = "bukti tindakan bedah (laporan operasi/anestesi) tidak ditemukan"  # the one bertentangan-link note


def detect_pertentangan(episode: Episode, cfg: Config) -> list[FindingDraft]:
    """Return a PERTENTANGAN_BUKTI finding per surgical claim whose required support is absent or late.

    ``cfg`` is accepted for the uniform ``run_detectors`` seam but unused: the surgical code set is a
    module constant (see ``_SURGICAL_PROCEDURE_CODES``), not a runtime dial.
    """
    evidence_by_id = {e.id: e for e in episode.evidence}
    active = [c for c in episode.claims if c.status not in _INACTIVE]

    drafts: list[FindingDraft] = []
    for claim in _representatives(active):
        codes = sorted(
            {ln.code for ln in claim.lines if ln.type == "PROCEDURE" and ln.code in _SURGICAL_PROCEDURE_CODES}
        )
        for code in codes:
            draft = _assess(episode, claim, code, evidence_by_id)
            if draft is not None:
                drafts.append(draft)
    # Emit in a stable (claim_version_id, code) order. Inputs are already deterministic (representative
    # order + sorted codes), so this is normalization for stable output/tests, not hash-seed hardening.
    drafts.sort(key=lambda d: (d.claim_version_id or "", d.reasons["detail"]["procedureCode"]))
    return drafts


def _assess(
    episode: Episode, claim: ClaimVersionView, code: str, evidence_by_id: dict[str, EvidenceView]
) -> FindingDraft | None:
    support = _linked(episode, claim, _REL_SUPPORT, evidence_by_id)
    if support:
        # Only reach the timing branch with a non-empty list — a vacuous all() over [] would be a spurious
        # MEDIUM. If every supporting doc was captured after the claim was submitted → late/external.
        if all(ev.captured_at > claim.submitted_at for ev in support):
            latest = max(support, key=lambda e: (e.captured_at, e.id))
            return _build(claim, code, latest, late=True)
        return None  # support present and at least one piece timely → clean

    # No supporting evidence → contradiction, but only if a source (``sumber``) record anchors the
    # bertentangan link. A surgical claim with no source record (the repeat-billing family: zero evidence)
    # has nothing to contradict → abstain. ``_linked`` returns id-sorted, so [0] is the lowest-id anchor.
    sources = _linked(episode, claim, _REL_SOURCE, evidence_by_id)
    return _build(claim, code, sources[0], late=False) if sources else None


def _linked(
    episode: Episode, claim: ClaimVersionView, relation: str, evidence_by_id: dict[str, EvidenceView]
) -> list[EvidenceView]:
    """In-episode evidence records linked to this claim version by ``relation``, sorted by id.

    Keys strictly on the representative version's id, so a link left on a *superseded* version is invisible.
    Safe here: the import attaches links to the current version (and the generator pins ``version == 1``, so
    there are no multi-version claims in the data) — mirrors ``repeat_billing._linked_evidence``'s assumption.
    """
    return sorted(
        (
            evidence_by_id[ln.evidence_id]
            for ln in episode.links
            if ln.claim_version_id == claim.id and ln.relation == relation and ln.evidence_id in evidence_by_id
        ),
        key=lambda e: e.id,
    )


def _build(claim: ClaimVersionView, code: str, anchor: EvidenceView, *, late: bool) -> FindingDraft:
    label = _PROC_LABELS.get(code, code)
    if late:
        # Support is present but late/external — a lower-severity "needs more info" finding. It emits NO
        # bertentangan link: the anchor is a doc that already `mendukung`-supports this claim, so tagging it
        # `bertentangan` too would be a self-contradictory pair (see module docstring).
        severity, score, reason_code = Severity.MEDIUM, _LATE_SCORE, _REASON_LATE
        message = (
            f"Klaim bedah {code} ({label}): bukti pendukung tercatat setelah klaim diajukan — perlu "
            f"verifikasi (kemungkinan keterlambatan administratif / rujukan eksternal)."
        )
        links: tuple[EvidenceLinkDraft, ...] = ()
    else:
        severity, score, reason_code = Severity.HIGH, _MISSING_SCORE, _REASON_MISSING
        message = f"Klaim bedah {code} ({label}) tanpa bukti tindakan (laporan operasi/anestesi tidak ditemukan)."
        links = (EvidenceLinkDraft(evidence_id=anchor.id, claim_version_id=claim.id, note=_NOTE_MISSING),)

    reasons = {
        "messages": [message],
        "detail": {"procedureCode": code, "claimNo": claim.claim_no, "severityReason": reason_code},
    }
    return FindingDraft(
        detector=DetectorType.PERTENTANGAN_BUKTI,
        score=score,
        severity=severity,
        reasons=reasons,
        evidence_refs=[anchor.id],
        # Key on (claim_no, code), NOT the version-row id: a resubmission collapses to a different
        # representative version across runs, but claim_no is stable — so a re-detect of the same logical
        # contradiction conflicts onto the first row (mirrors repeat_billing). Excludes severity/anchor so
        # identity stays corpus-invariant. Canonical JSON (not a delimiter join) keeps the encoding injective.
        dedupe_key=hashlib.sha256(
            json.dumps([claim.claim_no, code], separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).hexdigest(),
        claim_version_id=claim.id,
        evidence_links=links,
    )


def _representatives(claims: list[ClaimVersionView]) -> list[ClaimVersionView]:
    """One representative per ``claim_no`` — prefer ``is_current``, else highest ``version``. (Duplicated
    from ``repeat_billing`` to keep the two detectors independent pure functions; a third consumer would
    hoist this + ``_INACTIVE`` to a shared home. Two versions of one claim are a resubmission, not two.)"""
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
