"""DB integration: load_episode surfaces the claim↔evidence links (the PERTENTANGAN_BUKTI signal).

This test seeds an EvidenceRecord + EvidenceLink, which `tilik_app` can INSERT but NOT DELETE (the spine is
append-only), and the Episode can't be deleted while its evidence references it. So it uses uniquely-ided
rows and deletes only the link (which IS grantable) on teardown; the episode + evidence persist in the
isolated test DB (harmless — every run uses fresh ids, no global-count assertions). Populated-spine cleanup
is a Prompt 08 concern (owner-seeded fixtures).
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from psycopg.types.json import Jsonb

from detector import repository
from detector.models import DetectorType, FindingDraft, Severity

_SEEDED_AT = datetime(2026, 1, 1, 0, 0, 0)


@pytest.fixture
def linked_episode(conn):
    episode_id = "linktest-ep-" + uuid.uuid4().hex
    evidence_id = "linktest-ev-" + uuid.uuid4().hex
    link_id = "linktest-el-" + uuid.uuid4().hex
    conn.execute(
        'INSERT INTO "Episode" ("id","patientToken","facilityId","startedAt","updatedAt") '
        "VALUES (%s,%s,%s,%s,%s)",
        (episode_id, "patient:linktest", "FAC-LINK", _SEEDED_AT, _SEEDED_AT),
    )
    conn.execute(
        'INSERT INTO "EvidenceRecord" ("id","episodeId","kind","payload","contentHash","capturedAt") '
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (evidence_id, episode_id, "LAB", Jsonb({"result": "synthetic"}), "hash-linktest", _SEEDED_AT),
    )
    conn.execute(
        'INSERT INTO "EvidenceLink" ("id","evidenceId","claimVersionId","relation","note") '
        "VALUES (%s,%s,%s,%s,%s)",
        (link_id, evidence_id, None, "bertentangan", "contradicts the claim"),
    )
    yield episode_id, evidence_id
    # Only the link is deletable by tilik_app; evidence + episode are append-only (left in the throwaway DB).
    conn.execute('DELETE FROM "EvidenceLink" WHERE "id"=%s', (link_id,))


def test_load_episode_surfaces_evidence_links(conn, linked_episode) -> None:
    episode_id, evidence_id = linked_episode

    episode = repository.load_episode(conn, episode_id)

    assert episode is not None
    assert len(episode.evidence) == 1 and episode.evidence[0].id == evidence_id
    assert len(episode.links) == 1
    link = episode.links[0]
    assert link.relation == "bertentangan"
    assert link.evidence_id == evidence_id
    assert link.claim_version_id is None
    # Redacting __repr__ must not leak the free-text note.
    assert "contradicts" not in repr(link)


def test_insert_findings_writes_rows(conn, factory) -> None:
    # Exercise the write path with a non-empty draft list: Jsonb wrapping of reasons/evidenceRefs, the uuid
    # id, and the evidenceRefs array CHECK.
    episode_id = factory.episode()
    draft = FindingDraft(
        detector=DetectorType.CLONING,
        score=0.75,
        severity=Severity.MEDIUM,
        reasons={"rule": "exact-content-match"},
        evidence_refs=["ev-1", "ev-2"],
        dedupe_key="dedupe-contract-test",
    )
    with conn.transaction():
        repository.insert_findings(conn, episode_id, [draft])

    row = conn.execute(
        'SELECT "detector", "score", "severity", "reasons", "dedupeKey", '
        'jsonb_typeof("evidenceRefs") AS refs_type FROM "Finding" WHERE "episodeId" = %s',
        (episode_id,),
    ).fetchone()
    assert row is not None
    assert row["detector"] == "CLONING"
    assert abs(row["score"] - 0.75) < 1e-9
    assert row["severity"] == "MEDIUM"
    assert row["reasons"] == {"rule": "exact-content-match"}
    assert row["dedupeKey"] == "dedupe-contract-test"
    assert row["refs_type"] == "array"  # DB CHECK jsonb_typeof = 'array'
    # Factory teardown deletes Finding rows by episodeId (tilik_app has DELETE on Finding).


def test_insert_findings_is_idempotent(conn, factory) -> None:
    # Re-inserting the SAME (episodeId, detector, dedupeKey) must conflict-skip, not duplicate and not raise —
    # the ON CONFLICT DO NOTHING guard a worker re-run / reaper requeue relies on.
    episode_id = factory.episode()
    draft = FindingDraft(
        detector=DetectorType.REPEAT_BILLING,
        score=1.0,
        severity=Severity.HIGH,
        reasons={"messages": ["dup"]},
        evidence_refs=[],
        dedupe_key="dedupe-idem",
    )
    with conn.transaction():
        repository.insert_findings(conn, episode_id, [draft])
    with conn.transaction():  # second insert: a conflict-skip (rowcount 0) must NOT raise
        repository.insert_findings(conn, episode_id, [draft])

    count = conn.execute(
        'SELECT count(*) AS n FROM "Finding" WHERE "episodeId"=%s', (episode_id,)
    ).fetchone()["n"]
    assert count == 1
