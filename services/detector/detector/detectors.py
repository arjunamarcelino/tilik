"""Detector entrypoint — the single seam the worker calls per episode.

Prompt 08 ships the first two detectors: REPEAT_BILLING (``repeat_billing.py``) and CLONING
(``cloning.py``). PERTENTANGAN_BUKTI lands in Prompt 09. Each detector is a pure function over the loaded
``Episode`` (+ the injected cross-episode ``corpus`` for cloning) and the runtime ``Config``, so detection is
unit-testable without a database and deterministic — a retried job over identical input produces identical
findings (see each detector's dedupe-key discipline).

Invariant: detection runs BETWEEN transactions (under autocommit) — never inside the claim or the write
transaction. A slow detector must hold no row lock and keep no transaction open. ``cfg`` is threaded in
explicitly (the process builds ``Config`` once in ``worker.main``); there is deliberately no module-global
config to re-parse the environment outside the fail-fast boot path.
"""

from __future__ import annotations

from collections.abc import Sequence

from .cloning import detect_cloning
from .config import Config
from .models import CloneDoc, Episode, FindingDraft
from .repeat_billing import detect_repeat_billing


def run_detectors(episode: Episode, corpus: Sequence[CloneDoc], cfg: Config) -> list[FindingDraft]:
    """Run every detector for an episode and return the combined findings.

    ``corpus`` is the cross-episode medical-record set the CLONING detector compares against (loaded by the
    worker via ``repository.load_clone_corpus``); REPEAT_BILLING ignores it.
    """
    return [
        *detect_repeat_billing(episode, cfg),
        *detect_cloning(episode, corpus, cfg),
    ]
