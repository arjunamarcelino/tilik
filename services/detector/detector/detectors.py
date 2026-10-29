"""Detector entrypoint.

Prompt 07 ships a NO-OP stub: ``run_detectors`` returns ``[]`` for every episode. The three real detectors
(``REPEAT_BILLING``, ``CLONING``, ``PERTENTANGAN_BUKTI``) land in Prompts 08–09 and will return
``FindingDraft``s whose ``score`` is in [0, 1] and whose ``evidence_refs`` is a JSON array (see the DB CHECK
constraints documented on ``FindingDraft``). Detectors MUST be deterministic, so a retried job produces
identical findings — ``Finding`` has no natural idempotency key until Prompt 08 adds one
(``UNIQUE(episodeId, detector, <content-hash>)`` + ``ON CONFLICT DO NOTHING``).

Invariant for Prompts 08–09: detection runs BETWEEN transactions (under autocommit), never inside the claim
or the write transaction — a slow detector must hold no row lock and keep no transaction open.
"""

from __future__ import annotations

from .models import Episode, FindingDraft


def run_detectors(episode: Episode) -> list[FindingDraft]:
    """Return findings for an episode. Stub: no detection logic yet (Prompts 08–09)."""
    return []
