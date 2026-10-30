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
from decimal import Decimal
from types import SimpleNamespace

import pytest
from psycopg.types.json import Jsonb

from _helpers import make_config, test_logger

from detector import repository
from detector.worker import Tick, run_once

_SEEDED_AT = datetime(2026, 1, 1, 0, 0, 0)  # evidence captured
_SUBMITTED_AT = datetime(2026, 1, 1, 1, 0, 0)  # claim submitted AFTER → but no 'mendukung' here, so irrelevant


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


# --- Prompt 09 aggregation: bertentangan link + Case + DETECT audit, end-to-end via run_once -----


@pytest.fixture
def contradiction_case(conn):
    """Seed a surgical contradiction episode (procedure 47.09, a 'sumber' medical record, NO 'mendukung'
    support) + a PENDING DETECT_EPISODE job. Append-only spine rows (claim/line/evidence/sumber-link) are
    seeded as tilik_app with unique ids and left in place on teardown (same precedent as corpus_episodes);
    the mutable rows the worker writes (Finding/Case/bertentangan-link) and the job ARE cleaned up."""
    ep = "linktest-ep-" + uuid.uuid4().hex
    cv = "linktest-cv-" + uuid.uuid4().hex
    ev = "linktest-ev-" + uuid.uuid4().hex
    job = "test-job-" + uuid.uuid4().hex  # test-job- prefix → swept by conftest before the pending check

    conn.execute(
        'INSERT INTO "Episode" ("id","patientToken","facilityId","startedAt","updatedAt") VALUES (%s,%s,%s,%s,%s)',
        (ep, "patient:e2e", "FAC-E2E", _SEEDED_AT, _SEEDED_AT),
    )
    conn.execute(
        'INSERT INTO "ClaimVersion" ("id","episodeId","version","claimNo","inacbgCode","amount","contentHash",'
        '"status","isCurrent","submittedAt") VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
        (cv, ep, 1, "E2E-CLM-" + cv[-8:], "X-1-01-0", Decimal("9000000.00"), "ch-" + cv, "ACTIVE", True, _SUBMITTED_AT),
    )
    conn.execute(
        'INSERT INTO "ClaimLine" ("id","claimVersionId","type","code","sequence") VALUES (%s,%s,%s,%s,%s)',
        ("linktest-ln-" + uuid.uuid4().hex, cv, "PROCEDURE", "47.09", 1),
    )
    conn.execute(
        'INSERT INTO "EvidenceRecord" ("id","episodeId","kind","payload","contentHash","capturedAt") '
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (ev, ep, "MEDICAL_RECORD", Jsonb({"narrative": "S: resume medis e2e."}), "ch-" + ev, _SEEDED_AT),
    )
    conn.execute(
        'INSERT INTO "EvidenceLink" ("id","evidenceId","claimVersionId","relation","note") VALUES (%s,%s,%s,%s,%s)',
        ("linktest-el-" + uuid.uuid4().hex, ev, cv, "sumber", None),
    )
    conn.execute(
        'INSERT INTO "OutboxJob" ("id","type","payload","status") VALUES (%s,%s,%s,%s)',
        (job, "DETECT_EPISODE", Jsonb({"v": 1, "episodeId": ep, "importBatchId": "test-batch"}), "PENDING"),
    )

    yield SimpleNamespace(episode=ep, claim=cv, evidence=ev, job=job)

    conn.execute('DELETE FROM "Finding" WHERE "episodeId"=%s', (ep,))
    conn.execute('DELETE FROM "Case" WHERE "episodeId"=%s', (ep,))
    conn.execute('DELETE FROM "EvidenceLink" WHERE "evidenceId"=%s AND "relation"=%s', (ev, "bertentangan"))
    conn.execute('DELETE FROM "OutboxJob" WHERE "id"=%s', (job,))
    # Append-only spine (episode/claim/line/evidence/sumber-link) persists — unique ids, no count assertions.
    # The DETECT AuditEvent rows also can't be deleted (append-only; tilik_app has DELETE revoked); they
    # accumulate harmlessly across runs because every assertion filters on this test's unique episodeId.


def _counts(conn, c) -> dict:
    return {
        "findings": conn.execute(
            'SELECT count(*) AS n FROM "Finding" WHERE "episodeId"=%s AND "detector"=%s', (c.episode, "PERTENTANGAN_BUKTI")
        ).fetchone()["n"],
        "links": conn.execute(
            'SELECT count(*) AS n FROM "EvidenceLink" WHERE "evidenceId"=%s AND "relation"=%s', (c.evidence, "bertentangan")
        ).fetchone()["n"],
        "cases": conn.execute('SELECT count(*) AS n FROM "Case" WHERE "episodeId"=%s', (c.episode,)).fetchone()["n"],
        "audits": conn.execute(
            'SELECT count(*) AS n FROM "AuditEvent" WHERE "targetId"=%s AND "action"=%s', (c.episode, "DETECT")
        ).fetchone()["n"],
    }


def test_contradiction_writes_finding_link_case_and_audit(conn, contradiction_case, db_dsn) -> None:
    cfg = make_config(db_dsn.value)

    tick = run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])  # empty corpus → cloning abstains

    assert tick is Tick.PROGRESSED
    assert conn.execute('SELECT "status" FROM "OutboxJob" WHERE "id"=%s', (contradiction_case.job,)).fetchone()[
        "status"
    ] == "DONE"

    c = _counts(conn, contradiction_case)
    assert c == {"findings": 1, "links": 1, "cases": 1, "audits": 1}

    finding = conn.execute(
        'SELECT "severity","caseId" FROM "Finding" WHERE "episodeId"=%s', (contradiction_case.episode,)
    ).fetchone()
    assert finding["severity"] == "HIGH" and finding["caseId"] is not None

    case = conn.execute(
        'SELECT "id","status","severity" FROM "Case" WHERE "episodeId"=%s', (contradiction_case.episode,)
    ).fetchone()
    assert case["status"] == "OPEN" and case["severity"] == "HIGH"
    assert finding["caseId"] == case["id"]  # the finding is attached to the case

    audit = conn.execute(
        'SELECT "actor","metadata" FROM "AuditEvent" WHERE "targetId"=%s AND "action"=%s',
        (contradiction_case.episode, "DETECT"),
    ).fetchone()
    assert audit["actor"] == cfg.worker_id
    assert audit["metadata"]["findings"]["PERTENTANGAN_BUKTI"] == 1
    assert audit["metadata"]["caseId"] == case["id"]


def test_reprocess_is_idempotent_but_audit_appends(conn, contradiction_case, db_dsn) -> None:
    cfg = make_config(db_dsn.value)

    run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])
    first = _counts(conn, contradiction_case)
    case_id_1 = conn.execute(
        'SELECT "id" FROM "Case" WHERE "episodeId"=%s', (contradiction_case.episode,)
    ).fetchone()["id"]

    # Force a reprocess (reaper-requeue analogue): put the job back to PENDING and run again.
    conn.execute(
        'UPDATE "OutboxJob" SET "status"=\'PENDING\', "lockedBy"=NULL, "lockedAt"=NULL WHERE "id"=%s',
        (contradiction_case.job,),
    )
    run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])
    second = _counts(conn, contradiction_case)

    # Finding/link/Case do NOT duplicate; the DETECT audit (append-only event log) grows by exactly one.
    assert first == {"findings": 1, "links": 1, "cases": 1, "audits": 1}
    assert second == {"findings": 1, "links": 1, "cases": 1, "audits": 2}
    case_id_2 = conn.execute(
        'SELECT "id" FROM "Case" WHERE "episodeId"=%s', (contradiction_case.episode,)
    ).fetchone()["id"]
    assert case_id_1 == case_id_2  # same stable Case across re-detection


def test_redetect_preserves_reviewer_state(conn, contradiction_case, db_dsn) -> None:
    # The worker and the (future) API both write Case as the same role; only the upsert's DO UPDATE clause
    # stops re-detection from resetting reviewer-owned workflow fields. Pin that contract: a re-detect must
    # leave status/assignedTo untouched (it may only refresh the derived severity).
    cfg = make_config(db_dsn.value)
    run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])

    conn.execute(
        'UPDATE "Case" SET "status"=%s, "assignedTo"=%s WHERE "episodeId"=%s',
        ("IN_REVIEW", "reviewer-x", contradiction_case.episode),
    )
    conn.execute(
        'UPDATE "OutboxJob" SET "status"=\'PENDING\', "lockedBy"=NULL, "lockedAt"=NULL WHERE "id"=%s',
        (contradiction_case.job,),
    )
    run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])

    case = conn.execute(
        'SELECT "status", "assignedTo", "severity" FROM "Case" WHERE "episodeId"=%s',
        (contradiction_case.episode,),
    ).fetchone()
    assert case["status"] == "IN_REVIEW"  # reviewer workflow state survived re-detection
    assert case["assignedTo"] == "reviewer-x"
    assert case["severity"] == "HIGH"  # detector-owned derived field still maintained


def test_audit_reports_existing_case_on_findingless_reprocess(conn, contradiction_case, db_dsn) -> None:
    # A finding-less re-detect of an already-flagged episode (e.g. a rule/corpus change) must still report
    # the episode's existing Case id in the DETECT audit, not null.
    cfg = make_config(db_dsn.value)
    run_once(conn, cfg, test_logger, load_corpus=lambda *_: [])
    case_id = conn.execute(
        'SELECT "id" FROM "Case" WHERE "episodeId"=%s', (contradiction_case.episode,)
    ).fetchone()["id"]

    conn.execute(
        'UPDATE "OutboxJob" SET "status"=\'PENDING\', "lockedBy"=NULL, "lockedAt"=NULL WHERE "id"=%s',
        (contradiction_case.job,),
    )
    run_once(conn, cfg, test_logger, detect=lambda *_: [], load_corpus=lambda *_: [])

    # The finding-less run's audit is the one with empty `findings`; its caseId is the existing Case, not null.
    meta = conn.execute(
        "SELECT \"metadata\" FROM \"AuditEvent\" WHERE \"targetId\"=%s AND \"action\"=%s "
        "AND \"metadata\"->'findings' = '{}'::jsonb",
        (contradiction_case.episode, "DETECT"),
    ).fetchone()["metadata"]
    assert meta["caseId"] == case_id
