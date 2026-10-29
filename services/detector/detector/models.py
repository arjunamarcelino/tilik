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

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any


class DetectorType(StrEnum):
    REPEAT_BILLING = "REPEAT_BILLING"
    CLONING = "CLONING"
    PERTENTANGAN_BUKTI = "PERTENTANGAN_BUKTI"


class Severity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


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

    def __repr__(self) -> str:  # never dump patient_token / facility_id / clinical content
        return (
            f"Episode(id={self.id!r}, patient={_mask_token(self.patient_token)}, "
            f"claims={len(self.claims)}, evidence={len(self.evidence)})"
        )


@dataclass(frozen=True)
class FindingDraft:
    """What a detector emits. Mapped to a ``Finding`` row by ``repository.insert_findings``.

    DB CHECK constraints the row must satisfy (init migration):
      * ``score`` in [0, 1] (the range check also rejects NaN),
      * ``evidence_refs`` serialises to a JSON **array** (``jsonb_typeof = 'array'``) — use ``[]`` for none.
    ``reasons``/``evidence_refs`` are wrapped with ``psycopg.types.json.Jsonb`` on insert (psycopg does not
    auto-adapt ``dict``/``list`` to ``jsonb``).
    """

    detector: DetectorType
    score: float
    severity: Severity
    reasons: dict[str, Any]
    evidence_refs: list[str]
    claim_version_id: str | None = None

    def __repr__(self) -> str:  # omit reasons (may carry clinical explanation text)
        return (
            f"FindingDraft(detector={self.detector}, severity={self.severity}, "
            f"score={self.score}, evidence_refs={len(self.evidence_refs)})"
        )
