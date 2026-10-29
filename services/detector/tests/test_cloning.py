"""CLONING detector — pure tests (no DB).

Recall + precision from the Prompt 04 manifest: against the whole-bundle corpus, the ONLY episodes flagged
must be exactly the planted ``fraud_cloning`` cluster (``clone_01``) — the 4 ``exception_soap_template``
episodes (shared scaffold, distinct content) and every clean episode must stay clean. Guard tests pin the
NaN/degenerate-corpus edges; a threshold-gap test pins the empirical justification for the 0.85 default.
"""

from __future__ import annotations

from datetime import datetime, timezone

from _bundle import clone_corpus, load_episodes, load_labels, require_bundle

from detector.cloning import detect_cloning, strip_boilerplate
from detector.config import CLONING_MIN_CORPUS, Config
from detector.models import CloneDoc, DetectorType, Episode, EvidenceView, Severity


def _cfg(**kwargs) -> Config:
    return Config(
        app_database_url="unused", poll_interval_s=0.01, max_attempts=5, log_level="info",
        worker_id="test", **kwargs,
    )


def _record(narrative: str, *, ev_id="ev-1") -> EvidenceView:
    return EvidenceView(
        id=ev_id, kind="MEDICAL_RECORD", object_key=None, payload={"narrative": narrative},
        content_hash="", fingerprint=None, captured_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )


def _episode(records) -> Episode:
    return Episode(
        id="ep-x", patient_token="patient:x", facility_id="F",
        started_at=datetime(2026, 3, 1, tzinfo=timezone.utc), ended_at=None, import_batch_id=None,
        claims=[], evidence=records, links=[],
    )


def _medical_refs(episodes, labels) -> set[str]:
    return {ref for ref in episodes if any(e.kind == "MEDICAL_RECORD" for e in episodes[ref].evidence)}


# --- Manifest-driven recall + precision ---------------------------------------------------------


def test_flags_exactly_the_planted_clone_cluster() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    flagged = set()
    for ref in _medical_refs(episodes, labels):
        if detect_cloning(episodes[ref], clone_corpus(episodes, ref), cfg):
            flagged.add(ref)
    expected = {ref for ref, lbl in labels.items() if lbl.get("category") == "fraud_cloning"}

    assert expected, "manifest should contain a planted fraud_cloning cluster"
    assert flagged == expected  # clones flagged; SOAP-template exceptions + clean narratives stay clean


def test_clone_findings_are_well_formed() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    clone_refs = sorted(ref for ref, lbl in labels.items() if lbl.get("category") == "fraud_cloning")
    for ref in clone_refs:
        findings = detect_cloning(episodes[ref], clone_corpus(episodes, ref), cfg)
        assert len(findings) == 1
        f = findings[0]
        assert f.detector is DetectorType.CLONING
        assert cfg.cloning_threshold <= f.score <= 1.0  # clamped, above threshold
        assert f.severity is Severity.HIGH  # byte-identical clones sit at ~1.0 ≥ high cutoff
        assert len(f.evidence_refs) >= 2  # current record + at least one matched sibling
        assert f.reasons["messages"] and f.dedupe_key
        # matched episodes are the OTHER clones in the cluster
        assert set(f.reasons["detail"]["matchedEpisodes"]) <= set(clone_refs) - {ref}


def test_soap_template_exceptions_are_not_flagged() -> None:
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    for ref, lbl in labels.items():
        if lbl.get("category") == "exception_soap_template":
            assert detect_cloning(episodes[ref], clone_corpus(episodes, ref), cfg) == []


def test_threshold_sits_in_the_gap_between_clusters() -> None:
    # Pin the empirical justification: the clone cluster's cosine floor is far above the default threshold,
    # and the SOAP-template cluster's ceiling far below — so 0.85 cleanly separates them with margin.
    require_bundle()
    episodes, labels = load_episodes(), load_labels()
    cfg = _cfg()

    clone_scores, soap_scores = [], []
    for ref, lbl in labels.items():
        findings = detect_cloning(episodes[ref], clone_corpus(episodes, ref), _cfg(cloning_threshold=0.0))
        if not findings:
            continue
        if lbl.get("category") == "fraud_cloning":
            clone_scores.append(findings[0].score)
        elif lbl.get("category") == "exception_soap_template":
            soap_scores.append(findings[0].reasons["detail"]["cosine"])

    assert clone_scores and min(clone_scores) > cfg.cloning_threshold
    if soap_scores:  # with threshold 0 every episode "matches" its best neighbour; SOAP tops out well below
        assert max(soap_scores) < cfg.cloning_threshold


# --- Guards -------------------------------------------------------------------------------------


def test_missing_narrative_returns_no_finding() -> None:
    assert detect_cloning(_episode([]), [CloneDoc("e", "p", "x y z") for _ in range(5)], _cfg()) == []


def test_all_boilerplate_narrative_returns_no_finding() -> None:
    episode = _episode([_record("[Data sintetis — x]\nNama: A | No. RM: 1")])
    corpus = [CloneDoc(f"e{i}", f"p{i}", "pasien batuk demam") for i in range(5)]
    assert detect_cloning(episode, corpus, _cfg()) == []


def test_corpus_below_minimum_returns_no_finding() -> None:
    episode = _episode([_record("S: nyeri perut kanan bawah O: mcburney A: apendisitis P: apendektomi")])
    tiny = [CloneDoc(f"e{i}", f"p{i}", episode.evidence[0].payload["narrative"]) for i in range(CLONING_MIN_CORPUS - 1)]
    assert detect_cloning(episode, tiny, _cfg()) == []


# --- strip_boilerplate --------------------------------------------------------------------------


def test_strip_boilerplate_removes_disclaimer_and_identity_keeps_clinical() -> None:
    narrative = (
        "[Data sintetis — nama fiktif, bukan pasien nyata.]\n"
        "Nama: Budi Santoso | No. RM: SYN-RM-0001 | Usia: 40 tahun\n"
        "S: Pasien mengeluh nyeri perut.\nO: composmentis.\nA: apendisitis.\nP: apendektomi."
    )
    stripped = strip_boilerplate(narrative)
    assert "Data sintetis" not in stripped
    assert "Nama:" not in stripped and "No. RM" not in stripped
    assert "S: Pasien mengeluh nyeri perut." in stripped
    assert "P: apendektomi." in stripped
