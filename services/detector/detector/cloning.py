"""CLONING detector — TF-IDF cosine over medical-record narratives across episodes.

Signal: a near-identical narrative reused across DIFFERENT patient identities (copy-paste fraud) — the
hard-to-justify pattern, distinct from benign same-patient copy-forward. The generator plants k episodes,
different patients, byte-identical narrative except the name/MRN line.

Method (explainable + deterministic, not a black box):
  * strip the two deterministic boilerplate lines (the ``[Data sintetis …]`` disclaimer — identical in every
    narrative — and the ``Nama: … | No. RM: …`` identity line, which is the ONE part a clone changes and so
    must be removed or it would dilute a true clone's score). Clinical sentences are NOT regex-scrubbed.
  * TF-IDF over **word 1–3-grams** of {current + corpus}, dropping terms common across the corpus
    (``CLONING_MAX_DF`` — see ``config.py`` for why this filter, not idf, is what separates copied CONTENT
    from shared STRUCTURE), then cosine of the current doc against each corpus doc. Char n-grams are the
    wrong tool here (shared scaffold inflates char overlap).
  * flag corpus docs with cosine ≥ ``cfg.cloning_threshold`` (default 0.85). After the ``max_df`` filter,
    clones sit at ≈1.0 and every template/clean narrative at ≈0.0 (verified against the Prompt 04 manifest),
    so 0.85 separates them with wide margin.

Determinism: ``TfidfVectorizer`` sorts its vocabulary (document order only permutes rows, never indices),
and cosine stays on the sparse path (no multithreaded BLAS) — so a FIXED corpus yields bit-identical scores.
The corpus is read in its own snapshot, so after new imports idf shifts and the same pair's score drifts.
Finding *identity* (the dedupe key) is anchored on the source record id, NOT the matched set — so it is
corpus-invariant: a re-detect after the corpus grew still conflicts onto the first row, and ON CONFLICT
freezes its first-written score/matched set. (The matched evidence lives in ``reasons``, as payload.)

Known limitation: detection is per-episode against the corpus as it exists when the job runs. Within one
import (all siblings commit together) the signal is symmetric; but a clone pair split across two imports is
not re-detected, so the earlier-imported episode — detected before its sibling existed — goes unflagged and
only the later one fires. Fine for the single-bundle demo; a future "re-enqueue affected episodes on import"
or a batch cross-check would close it.
"""

from __future__ import annotations

import difflib
import hashlib
from collections.abc import Sequence

from .config import CLONING_HIGH_CUTOFF, CLONING_MAX_DF, CLONING_MIN_CORPUS, Config
from .models import CloneDoc, DetectorType, Episode, EvidenceView, FindingDraft, Severity

_MEDICAL_RECORD = "MEDICAL_RECORD"
_DISCLAIMER_PREFIX = "[Data sintetis"
_IDENTITY_PREFIX = "Nama:"

_VECTORIZER_KWARGS = dict(
    analyzer="word",
    ngram_range=(1, 3),  # unigrams keep clones ≈1.0; 2–3-grams reward contiguous verbatim phrasing
    lowercase=True,
    token_pattern=r"(?u)\b\w\w+\b",  # explicit: a future sklearn default change can't silently drift tokens
    min_df=1,  # keep singletons — distinctive clinical content is what a clone shares
    max_df=CLONING_MAX_DF,  # drop corpus-common terms (the content-vs-structure separator; rationale in config.py)
    sublinear_tf=True,
    norm="l2",  # cosine == dot product; neutralizes length (e.g. stripped vs unstripped)
    use_idf=True,
    smooth_idf=True,
)


def strip_boilerplate(narrative: str) -> str:
    """Drop the two deterministic lines (disclaimer, identity) and blank lines; keep the clinical S/O/A/P."""
    kept = [
        line
        for line in narrative.splitlines()
        if line.strip()
        and not line.lstrip().startswith(_DISCLAIMER_PREFIX)
        and not line.lstrip().startswith(_IDENTITY_PREFIX)
    ]
    return "\n".join(kept)


def episode_has_comparable_record(episode: Episode) -> bool:
    """True if the episode has a medical-record narrative worth comparing — lets the worker skip the
    cross-episode corpus read when CLONING has nothing to compare (no narrative → detect_cloning returns [])."""
    return _current_record(episode) is not None


def detect_cloning(episode: Episode, corpus: Sequence[CloneDoc], cfg: Config) -> list[FindingDraft]:
    """Return at most one CLONING finding for this episode (listing all matched evidence)."""
    found = _current_record(episode)
    if found is None:
        return []  # no medical-record narrative to compare
    record, narrative = found
    current_text = strip_boilerplate(narrative)
    if not current_text.strip():
        return []  # narrative was all boilerplate
    if len(corpus) < CLONING_MIN_CORPUS:
        return []  # below the floor the max_df filter prunes even clone content → no detection (see config)

    corpus_texts = [strip_boilerplate(doc.narrative) for doc in corpus]
    sims = _cosine_against_corpus(current_text, corpus_texts)
    if sims is None:
        return []  # empty vocabulary (all-boilerplate corpus) — nothing to compare

    # Carry each match's corpus index so the best-match text is a direct lookup — no fragile, O(n)
    # corpus.index(best_doc) value-equality rescan (which compares full narratives field-by-field).
    matches = [
        (i, doc, min(1.0, sims[i]))
        for i, doc in enumerate(corpus)
        if sims[i] >= cfg.cloning_threshold
    ]
    if not matches:
        return []

    return [_build_finding(episode, record, corpus_texts, current_text, sims, matches, cfg)]


def _build_finding(
    episode: Episode,
    record: EvidenceView,
    corpus_texts: list[str],
    current_text: str,
    sims: list[float],
    matches: list[tuple[int, CloneDoc, float]],
    cfg: Config,
) -> FindingDraft:
    max_cosine = max(score for _, _, score in matches)
    best_i = max(matches, key=lambda m: m[2])[0]
    best_text = corpus_texts[best_i]

    matched_evidence = sorted({record.id} | {doc.evidence_id for _, doc, _ in matches})
    matched_episodes = sorted({doc.episode_id for _, doc, _ in matches})
    shared_span = _longest_shared_span_words(current_text, best_text)
    # Negative contrast: the best score among NON-matching corpus docs — "vs unrelated SOAP ~0.40" — preempts
    # the "all SOAP notes look alike" objection. None if every corpus doc matched.
    contrast = max((s for s in sims if s < cfg.cloning_threshold), default=None)

    message = (
        f"Narasi rekam medis hampir identik (cosine {max_cosine:.2f}) dengan {len(matched_episodes)} "
        f"episode lain berbeda identitas; blok {shared_span} kata berurutan sama."
    )
    if contrast is not None:
        message += f" Narasi SOAP tak-terkait hanya ~{contrast:.2f}."
    reasons = {
        "messages": [message],
        "detail": {
            "cosine": round(max_cosine, 4),
            "threshold": cfg.cloning_threshold,
            "contrastCosine": None if contrast is None else round(contrast, 4),
            "sharedSpanWords": shared_span,
            "matchedEpisodes": matched_episodes,
            "matchedEvidence": matched_evidence,
        },
    }
    severity = Severity.HIGH if max_cosine >= CLONING_HIGH_CUTOFF else Severity.MEDIUM
    return FindingDraft(
        detector=DetectorType.CLONING,
        score=max_cosine,
        severity=severity,
        reasons=reasons,
        evidence_refs=matched_evidence,
        # Identity is (episode, CLONING) anchored on the source record id. detect_cloning emits at most one
        # finding per episode, and the matched-evidence set is PAYLOAD that shifts as the corpus grows (a
        # later-imported sibling would change it); keying on the stable record id keeps a re-detect
        # conflicting onto the first row regardless of corpus drift — the frozen-first-write guarantee.
        dedupe_key=hashlib.sha256(record.id.encode("utf-8")).hexdigest(),
        claim_version_id=_source_claim(episode, record.id),
    )


def _cosine_against_corpus(current: str, corpus: list[str]) -> list[float] | None:
    """TF-IDF-fit {current, *corpus}; return cosine of row 0 vs the rest. None on empty vocabulary.

    sklearn is imported here (not at module load) so the worker pays the import cost only when cloning runs.
    Stays on the sparse CSR path — never ``.toarray()`` — for bit-reproducible float results.
    """
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    try:
        tfidf = TfidfVectorizer(**_VECTORIZER_KWARGS).fit_transform([current, *corpus])
    except ValueError:
        return None  # "empty vocabulary" — e.g. an all-punctuation corpus
    return [float(x) for x in cosine_similarity(tfidf[0], tfidf[1:]).ravel()]


def _longest_shared_span_words(a: str, b: str) -> int:
    """Length (in words) of the longest contiguous run shared by two narratives — a concrete, reviewer-facing
    'these N words are identical' explanation. Cheap; computed only for the single best match."""
    a_words, b_words = a.split(), b.split()
    block = difflib.SequenceMatcher(a=a_words, b=b_words, autojunk=False).find_longest_match(
        0, len(a_words), 0, len(b_words)
    )
    return block.size


def _current_record(episode: Episode) -> tuple[EvidenceView, str] | None:
    """The episode's representative medical record and its narrative (lowest evidence id among those with a
    narrative). Returns the text alongside the record so callers never re-subscript ``payload`` (typed
    ``dict | None``). Episodes carry one MEDICAL_RECORD in the synthetic data; if several ever appear, the
    lowest-id one is the deterministic representative (a stable choice beats concatenation)."""
    for evidence in sorted((e for e in episode.evidence if e.kind == _MEDICAL_RECORD), key=lambda e: e.id):
        narrative = _narrative_of(evidence)
        if narrative is not None:
            return evidence, narrative
    return None


def _narrative_of(evidence: EvidenceView) -> str | None:
    if evidence.payload and isinstance(evidence.payload.get("narrative"), str):
        text = evidence.payload["narrative"]
        return text if text.strip() else None
    return None


def _source_claim(episode: Episode, evidence_id: str) -> str | None:
    """The claim the record sources (``relation='sumber'``), if any — the finding's anchoring claim."""
    for link in episode.links:
        if link.evidence_id == evidence_id and link.relation == "sumber":
            return link.claim_version_id
    return None
