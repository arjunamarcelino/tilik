"""In-memory contracts the detector operates on.

Two halves, both frozen so Prompts 08–09 build on a stable shape:
  * the INPUT — ``Episode`` + its ``ClaimVersionView`` / ``ClaimLineView`` / ``EvidenceView`` children,
  * the OUTPUT — ``FindingDraft`` (what ``run_detectors`` returns; mapped to a ``Finding`` row on write).

StrEnum mirrors of the shared enums (``packages/shared/src/enums.ts`` — the single source of truth) live
here too. There is no Python parity guard; keep them in sync by hand (same convention as
``data/synthetic``). Because ``StrEnum`` subclasses ``str``, members adapt directly as text/enum SQL params.

PRIVACY: ``Episode``/``ClaimVersionView`` carry a ``patient_token`` (a stable cross-episode re-identification
lever) and clinical detail. Both define a redacting ``__repr__`` so a stray ``log.info(f"{episode}")`` or a
traceback frame-local cannot dump sensitive content — only opaque ids and shapes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any, NamedTuple


class DetectorType(StrEnum):
    REPEAT_BILLING = "REPEAT_BILLING"
    CLONING = "CLONING"
    PERTENTANGAN_BUKTI = "PERTENTANGAN_BUKTI"


class Severity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# Severity ordering lives with the enum (not in a detector) — it's a property of the type, reused by the
# worker to derive a Case's severity. Mirrors the Prisma enum's declaration order, which is also how
# Postgres orders `max("severity")` in the Case recompute (so both sides agree on LOW < MEDIUM < HIGH).
_SEVERITY_RANK = {Severity.LOW: 0, Severity.MEDIUM: 1, Severity.HIGH: 2}


def max_severity(items: Iterable[Severity]) -> Severity:
    """The highest severity in ``items`` (LOW < MEDIUM < HIGH). Raises ``ValueError`` on an empty iterable —
    the worker only derives a case severity when the episode has at least one finding."""
    return max(items, key=_SEVERITY_RANK.__getitem__)


def _mask_token(token: str) -> str:
    """Render a patient token as ``patient:<first6>…`` so it is recognisable but not reversible in logs."""
    return f"patient:{token[:6]}…" if token else "patient:∅"


@dataclass(frozen=True)
class ClaimLineView:
    type: str  # ClaimLineType — "DIAGNOSIS" | "PROCEDURE"
    code: str
    sequence: int
    description: str | None
    amount: Decimal | None  # Decimal, never float — matches the canonical money() 2-dp rule

    def __repr__(self) -> str:  # omit code/description/amount (clinical content)
        return f"ClaimLineView(type={self.type!r}, sequence={self.sequence})"


@dataclass(frozen=True)
class ClaimVersionView:
    id: str
    version: int
    claim_no: str
    inacbg_code: str
    amount: Decimal  # Decimal(14,2)
    content_hash: str
    fingerprint: str | None
    status: str  # ClaimStatus
    is_current: bool
    submitted_at: datetime  # UTC (coerced from the naive DB timestamp at the repository boundary)
    lines: list[ClaimLineView] = field(default_factory=list)

    def __repr__(self) -> str:  # redact clinical detail (codes/amounts/lines) from logs & tracebacks
        return f"ClaimVersionView(id={self.id!r}, version={self.version}, lines={len(self.lines)})"


@dataclass(frozen=True)
class EvidenceView:
    id: str
    kind: str  # EvidenceKind
    object_key: str | None
    payload: dict[str, Any] | None
    content_hash: str
    fingerprint: str | None
    captured_at: datetime  # UTC (coerced at the repository boundary)

    def __repr__(self) -> str:  # omit payload (may carry clinical text)
        return f"EvidenceView(id={self.id!r}, kind={self.kind!r})"


@dataclass(frozen=True)
class EvidenceLinkView:
    """A claim↔evidence relationship. ``relation='bertentangan'`` (contradicting) is the primary signal for
    the PERTENTANGAN_BUKTI detector; 'mendukung' (supporting) / 'sumber' (source) are the other values."""

    evidence_id: str
    claim_version_id: str | None  # nullable — a link can attach to the episode without a specific claim
    relation: str  # 'mendukung' | 'bertentangan' | 'sumber'
    note: str | None

    def __repr__(self) -> str:  # omit free-text note
        return (
            f"EvidenceLinkView(evidence_id={self.evidence_id!r}, "
            f"claim_version_id={self.claim_version_id!r}, relation={self.relation!r})"
        )


@dataclass(frozen=True)
class Episode:
    id: str
    patient_token: str
    facility_id: str
    started_at: datetime  # UTC (coerced at the repository boundary)
    ended_at: datetime | None
    import_batch_id: str | None
    # ALL versions (history matters for repeat-billing / cloning), not just the current one.
    claims: list[ClaimVersionView] = field(default_factory=list)
    evidence: list[EvidenceView] = field(default_factory=list)
    # Claim↔evidence links (relation = mendukung/bertentangan/sumber) — the PERTENTANGAN_BUKTI signal.
    links: list[EvidenceLinkView] = field(default_factory=list)

    def __repr__(self) -> str:  # never dump patient_token / facility_id / clinical content
        return (
            f"Episode(id={self.id!r}, patient={_mask_token(self.patient_token)}, "
            f"claims={len(self.claims)}, evidence={len(self.evidence)}, links={len(self.links)})"
        )


class CloneDoc(NamedTuple):
    """One comparison document for the CLONING detector: a medical-record narrative from ANOTHER episode.

    A ``NamedTuple`` (not a bare ``tuple[str, str, str]``) so the three same-typed string fields can't be
    silently transposed between the SQL projection and the detector's use — the type checker catches it.
    """

    evidence_id: str
    episode_id: str
    narrative: str


class EvidenceLinkDraft(NamedTuple):
    """A claim↔evidence link a detector asks the worker to write — the PERTENTANGAN_BUKTI detector emits a
    ``relation='bertentangan'`` link tying the in-tension evidence to the offending claim version. The write
    lives in ``repository.insert_evidence_links`` (the detector stays a pure function).

    ``note`` is ALWAYS a detector-authored constant string, never clinical content: a ``NamedTuple``'s
    default repr prints every field, so a stray log of a draft would otherwise leak it.
    """

    evidence_id: str
    claim_version_id: str | None
    relation: str  # 'bertentangan' (DB CHECK-constrained)
    note: str | None


@dataclass(frozen=True)
class FindingDraft:
    """What a detector emits. Mapped to a ``Finding`` row by ``repository.insert_findings``.

    DB CHECK constraints the row must satisfy (init migration):
      * ``score`` in [0, 1] (the range check also rejects NaN),
      * ``evidence_refs`` serialises to a JSON **array** (``jsonb_typeof = 'array'``) — use ``[]`` for none.
    ``reasons``/``evidence_refs`` are wrapped with ``psycopg.types.json.Jsonb`` on insert (psycopg does not
    auto-adapt ``dict``/``list`` to ``jsonb``).

    ``dedupe_key`` is a deterministic per-finding identity (sha256 hex the detector computes). It backs the
    ``@@unique([episodeId, detector, dedupeKey])`` + ``ON CONFLICT DO NOTHING`` on insert, so a worker re-run
    or reaper requeue can't double-insert. It must depend ONLY on the finding's corpus-invariant identity —
    the duplicated procedure + claim set for repeat-billing, the source medical-record id for cloning — never
    on the score or the matched set (both drift as the corpus grows), so re-detection conflicts onto the
    frozen first row. ``reasons`` keeps a ``messages`` list of
    human-readable Indonesian triggers plus a structured ``detail`` object; it must never carry narrative
    text or the patient token (it lands in a DB column the redacting ``__repr__`` can't protect).

    ``evidence_links`` is an optional second write target: ``bertentangan`` links the PERTENTANGAN_BUKTI
    detector asks ``repository.insert_evidence_links`` to write (``insert_findings`` ignores it). Defaulting
    to the empty tuple keeps the other detectors unchanged; it is immutable (not the mutable-default trap).
    """

    detector: DetectorType
    score: float
    severity: Severity
    reasons: dict[str, Any]
    evidence_refs: list[str]
    dedupe_key: str
    claim_version_id: str | None = None
    evidence_links: tuple[EvidenceLinkDraft, ...] = ()

    def __repr__(self) -> str:  # omit reasons (may carry clinical explanation text)
        return (
            f"FindingDraft(detector={self.detector}, severity={self.severity}, "
            f"score={self.score}, evidence_refs={len(self.evidence_refs)})"
        )
