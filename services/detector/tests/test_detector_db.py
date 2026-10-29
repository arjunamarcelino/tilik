"""DB integration (thin): the Prompt 08 repository additions.

Scope is deliberately narrow — the detection logic itself is proven by the pure tests. Here we only check
that ``load_clone_corpus`` talks to the schema correctly: whole-DB medical-record narratives, the current
episode excluded, ordered by evidence id. (ON CONFLICT idempotency is covered in test_episode_contract.)

Like test_episode_contract's link fixture, this seeds EvidenceRecords that ``tilik_app`` can INSERT but not
DELETE (append-only spine); it uses uniquely-ided ``linktest-`` rows and tears down only the Episodes it can
(evidence persists harmlessly in the isolated/throwaway test DB — fresh ids every run, no count assertions).
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from psycopg.types.json import Jsonb

from detector import repository

_SEEDED_AT = datetime(2026, 1, 1, 0, 0, 0)


@pytest.fixture
def corpus_episodes(conn):
    """Two episodes, each with one MEDICAL_RECORD narrative. Returns (ref_a, ev_a, ref_b, ev_b)."""
    made = []

    def mk(narrative: str):
        ep = "linktest-ep-" + uuid.uuid4().hex
        ev = "linktest-ev-" + uuid.uuid4().hex
        conn.execute(
            'INSERT INTO "Episode" ("id","patientToken","facilityId","startedAt","updatedAt") '
            "VALUES (%s,%s,%s,%s,%s)",
            (ep, "patient:corpus", "FAC-CORP", _SEEDED_AT, _SEEDED_AT),
        )
        conn.execute(
            'INSERT INTO "EvidenceRecord" ("id","episodeId","kind","payload","contentHash","capturedAt") '
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (ev, ep, "MEDICAL_RECORD", Jsonb({"narrative": narrative}), "hash-" + ev, _SEEDED_AT),
        )
        made.append(ep)
        return ep, ev

    ref_a, ev_a = mk("S: narasi A untuk korpus uji.")
    ref_b, ev_b = mk("S: narasi B untuk korpus uji.")
    yield ref_a, ev_a, ref_b, ev_b
    # No teardown: tilik_app cannot DELETE the append-only EvidenceRecord, and the Episode can't be deleted
    # while that evidence references it (FK). Both persist harmlessly in the throwaway/isolated test DB —
    # fresh unique ids every run, no global-count assertions (same precedent as test_episode_contract).


def test_load_clone_corpus_excludes_current_and_returns_narratives(conn, corpus_episodes) -> None:
    ref_a, ev_a, ref_b, ev_b = corpus_episodes

    corpus = repository.load_clone_corpus(conn, ref_a)

    by_id = {d.evidence_id: d for d in corpus}
    assert ev_a not in by_id  # current episode excluded by id
    assert ev_b in by_id and by_id[ev_b].episode_id == ref_b
    assert by_id[ev_b].narrative == "S: narasi B untuk korpus uji."


def test_load_clone_corpus_is_ordered_by_evidence_id(conn, corpus_episodes) -> None:
    ref_a, *_ = corpus_episodes
    corpus = repository.load_clone_corpus(conn, ref_a)
    ids = [d.evidence_id for d in corpus]
    assert ids == sorted(ids)  # deterministic order → stable TF-IDF vocabulary across runs
