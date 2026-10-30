"""All SQL the worker issues. Centralised here so identifier-quoting and the lease-fence invariants live in
one place.

Quoting: every Prisma identifier is camel/PascalCase and MUST be double-quoted. Values are ALWAYS passed as
``%(name)s`` placeholders — never f-strings / ``%`` / ``.format`` / ``+``. Enforced by
``tests/test_source_guards.py`` (placeholder-only SQL constants + no ``str.format`` building).

Lease fence: the terminal/requeue UPDATEs match on ``id AND status='PROCESSING' AND "lockedBy" = worker``,
so a Prompt 08 reaper that requeued a stale row (and a peer that re-claimed it) cannot be clobbered. The
caller checks ``rowcount`` and, on 0, raises ``LeaseLostError`` INSIDE the write transaction so the
findings-insert rolls back too.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from .models import (
    ClaimLineView,
    ClaimVersionView,
    CloneDoc,
    Episode,
    EvidenceLinkDraft,
    EvidenceLinkView,
    EvidenceView,
    FindingDraft,
    Severity,
)

DETECT_EPISODE = "DETECT_EPISODE"  # OutboxJob.type (mirror of @tilik/shared/constants OUTBOX_JOB_TYPE)
AUDIT_ACTION_DETECT = "DETECT"  # AuditEvent.action (mirror of @tilik/shared/constants AUDIT_ACTION.DETECT)


class LeaseLostError(RuntimeError):
    """This worker no longer owns the job (a reaper requeued it and a peer re-claimed). Not a failure."""


def _utc(dt: datetime | None) -> datetime | None:
    """Coerce a naive DB ``timestamp`` (Prisma stores UTC, no zone) to a tz-aware UTC datetime."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# --- Claim --------------------------------------------------------------------------------------

# Single atomic statement: the inner SELECT carries FOR UPDATE SKIP LOCKED (never the outer UPDATE), so two
# workers never claim the same row. ORDER BY ("createdAt","id") — the batch shares one transaction-stable
# createdAt, so "id" is the real tiebreaker (served without a sort by the (createdAt,id) partial index).
_CLAIM_SQL = """
WITH j AS (
    SELECT "id"
    FROM "OutboxJob"
    WHERE "status" = 'PENDING' AND "type" = %(type)s
    ORDER BY "createdAt", "id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE "OutboxJob" o
SET "status" = 'PROCESSING', "lockedBy" = %(worker)s, "lockedAt" = now()
FROM j
WHERE o."id" = j."id"
RETURNING o."id", o."type", o."payload", o."attempts";
"""


def claim_job(conn: psycopg.Connection, worker_id: str) -> dict[str, Any] | None:
    """Atomically claim the oldest PENDING DETECT_EPISODE job. Returns the job row, or None if none free."""
    return conn.execute(_CLAIM_SQL, {"type": DETECT_EPISODE, "worker": worker_id}).fetchone()


# --- Load episode (constant 5 queries; no N+1) --------------------------------------------------


def load_episode(conn: psycopg.Connection, episode_id: str) -> Episode | None:
    """Load the episode + all its claim versions (+lines) + evidence. Returns None if the episode is gone.

    The four reads run inside ONE read-only REPEATABLE READ transaction so the detector sees a single
    consistent snapshot — a concurrent resubmission (ingest adding a ClaimVersion+lines) committing between
    reads can't show the detector a claim set and a line set from different instants, which would make a
    retried job observe a different input (colliding with the deterministic-detector contract). The reads
    take no row locks and the tx commits immediately, so detect()/the write tx still run lock-free after.

    Loads in a constant 5 queries (episode, claim versions, all lines joined, evidence, claim↔evidence
    links) regardless of row counts — never per-claim.
    """
    with conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        ep = conn.execute(
            """
            SELECT "id", "patientToken", "facilityId", "startedAt", "endedAt", "importBatchId"
            FROM "Episode" WHERE "id" = %(id)s
            """,
            {"id": episode_id},
        ).fetchone()
        if ep is None:
            return None

        claim_rows = conn.execute(
            """
            SELECT "id", "version", "claimNo", "inacbgCode", "amount", "contentHash",
                   "fingerprint", "status", "isCurrent", "submittedAt"
            FROM "ClaimVersion" WHERE "episodeId" = %(id)s ORDER BY "version", "id"
            """,
            {"id": episode_id},
        ).fetchall()

        # All lines for the episode in ONE query (join on the spine), grouped in Python — never per-claim.
        line_rows = conn.execute(
            """
            SELECT l."claimVersionId", l."type", l."code", l."sequence", l."description", l."amount"
            FROM "ClaimLine" l
            JOIN "ClaimVersion" cv ON l."claimVersionId" = cv."id"
            WHERE cv."episodeId" = %(id)s
            ORDER BY cv."version", l."sequence", l."id"
            """,
            {"id": episode_id},
        ).fetchall()

        evidence_rows = conn.execute(
            """
            SELECT "id", "kind", "objectKey", "payload", "contentHash", "fingerprint", "capturedAt"
            FROM "EvidenceRecord" WHERE "episodeId" = %(id)s ORDER BY "capturedAt", "id"
            """,
            {"id": episode_id},
        ).fetchall()

        # Claim↔evidence links for this episode (one query, joined via the evidence's episode).
        link_rows = conn.execute(
            """
            SELECT el."evidenceId", el."claimVersionId", el."relation", el."note"
            FROM "EvidenceLink" el
            JOIN "EvidenceRecord" ev ON el."evidenceId" = ev."id"
            WHERE ev."episodeId" = %(id)s
            ORDER BY el."id"
            """,
            {"id": episode_id},
        ).fetchall()

    lines_by_claim: dict[str, list[ClaimLineView]] = {}
    for r in line_rows:
        lines_by_claim.setdefault(r["claimVersionId"], []).append(
            ClaimLineView(
                type=r["type"], code=r["code"], sequence=r["sequence"],
                description=r["description"], amount=r["amount"],
            )
        )

    claims = [
        ClaimVersionView(
            id=c["id"], version=c["version"], claim_no=c["claimNo"], inacbg_code=c["inacbgCode"],
            amount=c["amount"], content_hash=c["contentHash"], fingerprint=c["fingerprint"],
            status=c["status"], is_current=c["isCurrent"], submitted_at=_utc(c["submittedAt"]),
            lines=lines_by_claim.get(c["id"], []),
        )
        for c in claim_rows
    ]
    evidence = [
        EvidenceView(
            id=e["id"], kind=e["kind"], object_key=e["objectKey"], payload=e["payload"],
            content_hash=e["contentHash"], fingerprint=e["fingerprint"], captured_at=_utc(e["capturedAt"]),
        )
        for e in evidence_rows
    ]
    links = [
        EvidenceLinkView(
            evidence_id=link["evidenceId"], claim_version_id=link["claimVersionId"],
            relation=link["relation"], note=link["note"],
        )
        for link in link_rows
    ]
    return Episode(
        id=ep["id"], patient_token=ep["patientToken"], facility_id=ep["facilityId"],
        started_at=_utc(ep["startedAt"]), ended_at=_utc(ep["endedAt"]),
        import_batch_id=ep["importBatchId"], claims=claims, evidence=evidence, links=links,
    )


# --- Clone corpus (cross-episode comparison set for the CLONING detector) -----------------------

# All OTHER episodes' medical-record narratives, deterministically ordered by evidence id so the TF-IDF
# vocabulary indices are stable across runs. Excludes the current episode by id (NEVER by narrative text — a
# true clone is byte-identical and a text exclusion would wrongly drop the match). Whole-DB (not filtered by
# importBatchId): clones are planted across episodes/batches. Placeholder-only; narrative presence is
# filtered in Python so the SQL stays a plain constant.
_CLONE_CORPUS_SQL = """
SELECT "id", "episodeId", "payload"
FROM "EvidenceRecord"
WHERE "episodeId" <> %(ep)s AND "kind" = 'MEDICAL_RECORD'
ORDER BY "id"
"""


def load_clone_corpus(conn: psycopg.Connection, exclude_episode_id: str) -> list[CloneDoc]:
    """Load every other episode's medical-record narrative as the cloning comparison corpus.

    Runs as its own autocommit read (the worker calls it BETWEEN ``load_episode``'s REPEATABLE READ snapshot
    and the write transaction) — so the corpus is a separate snapshot. This is exactly why cloning's score is
    reproducible only for a *fixed* corpus: a retry after new imports legitimately sees different idf.
    """
    rows = conn.execute(_CLONE_CORPUS_SQL, {"ep": exclude_episode_id}).fetchall()
    corpus: list[CloneDoc] = []
    for r in rows:
        payload = r["payload"] or {}
        narrative = payload.get("narrative")
        if isinstance(narrative, str) and narrative.strip():
            corpus.append(CloneDoc(evidence_id=r["id"], episode_id=r["episodeId"], narrative=narrative))
    return corpus


# --- Findings (write path) ----------------------------------------------------------------------


def insert_findings(conn: psycopg.Connection, episode_id: str, drafts: list[FindingDraft]) -> None:
    """Insert Finding rows idempotently. ``reasons``/``evidenceRefs`` are wrapped with Jsonb (psycopg won't
    auto-adapt dict/list → jsonb).

    ``Finding.id`` has no DB default (Prisma mints a cuid client-side), so the id is generated here — a
    uuid, consistent with how the import pipeline mints ids. ``dedupeKey`` is the detector-computed identity
    backing ``@@unique([episodeId, detector, dedupeKey])``.

    IDEMPOTENCY: ``ON CONFLICT … DO NOTHING`` means a re-detect (worker re-run, or a reaper requeue + peer
    re-processing) conflicts onto the existing row instead of duplicating — Finding has no other natural key.
    A conflict-skip yields ``rowcount == 0`` on that statement, which is **success, not a lease loss**: the
    ``rowcount == 0 → LeaseLostError`` fence rule is confined to the OutboxJob mark_done/requeue UPDATEs
    (below). This function MUST NOT inspect rowcount — a future "safety" assert here would turn every
    legitimate dedupe skip into a transaction-rolling-back LeaseLostError and silently discard the job.
    No-op when ``drafts`` is empty.
    """
    for d in drafts:
        conn.execute(
            """
            INSERT INTO "Finding"
                ("id", "episodeId", "claimVersionId", "detector", "score", "severity", "reasons",
                 "evidenceRefs", "dedupeKey")
            VALUES (%(id)s, %(episodeId)s, %(claimVersionId)s, %(detector)s, %(score)s, %(severity)s,
                    %(reasons)s, %(evidenceRefs)s, %(dedupeKey)s)
            ON CONFLICT ("episodeId", "detector", "dedupeKey") DO NOTHING
            """,
            {
                "id": uuid.uuid4().hex,
                "episodeId": episode_id,
                "claimVersionId": d.claim_version_id,
                "detector": str(d.detector),
                "score": d.score,
                "severity": str(d.severity),
                "reasons": Jsonb(d.reasons),
                "evidenceRefs": Jsonb(d.evidence_refs),
                "dedupeKey": d.dedupe_key,
            },
        )


# --- Aggregation: bertentangan links, Case, DETECT audit (Prompt 09) ----------------------------
#
# All called INSIDE the worker's single write transaction (before the lease-fenced mark_done), so a
# reaper-preempted worker rolls the whole group back. Like insert_findings, the INSERT helpers here are
# idempotent and MUST NOT inspect rowcount — only the OutboxJob transitions below are lease-fenced.

# Idempotent insert: a conditional WHERE NOT EXISTS, not a DB unique constraint. EvidenceLink is a mutable,
# curated table the import pipeline also writes (sumber/mendukung), and its claimVersionId is nullable, so a
# global unique index would have real blast radius there. The check-then-insert is safe HERE because one
# worker holds the episode's lease and a bertentangan link is episode-scoped (non-null claimVersionId): a
# reaper-preempted peer's whole tx (incl. its duplicate link) rolls back at mark_done. A future
# cross-episode/multi-writer link would need a real unique index instead.
#
# The relation is HARD-CODED to 'bertentangan' (not a bound value): the detector may only ever record the
# contradiction relation, never the import pipeline's provenance relations (sumber/mendukung) — the write
# surface is constrained here, not left to the caller's draft.
_INSERT_EVIDENCE_LINK_SQL = """
INSERT INTO "EvidenceLink" ("id", "evidenceId", "claimVersionId", "relation", "note")
SELECT %(id)s, %(ev)s, %(cv)s, 'bertentangan', %(note)s
WHERE NOT EXISTS (
    SELECT 1 FROM "EvidenceLink"
    WHERE "evidenceId" = %(ev)s AND "claimVersionId" = %(cv)s AND "relation" = 'bertentangan'
)
"""

# DO UPDATE (not DO NOTHING) so a conflict still RETURNINGs the id — DO NOTHING returns zero rows.
# status/assignedTo are reviewer-owned and never reset by re-detection. On conflict the clause self-assigns
# "updatedAt" to its EXISTING value (not now()), so a no-op re-detect does NOT churn the "last updated" a
# reviewer sees — recompute_case_severity below owns the only meaningful bump. "updatedAt" is in the INSERT
# column list because the column is NOT NULL with no DB default (Prisma's @updatedAt runs in the query
# engine, which this raw psycopg3 path bypasses). The INSERT "severity" is only a NOT-NULL seed —
# recompute_case_severity sets the authoritative value from the attached findings.
_UPSERT_CASE_SQL = """
INSERT INTO "Case" ("id", "episodeId", "status", "severity", "updatedAt")
VALUES (%(id)s, %(ep)s, 'OPEN', %(severity)s, now())
ON CONFLICT ("episodeId") DO UPDATE SET "updatedAt" = "Case"."updatedAt"
RETURNING "id"
"""

# Authoritative case severity = max over the findings actually attached to it (NOT the transient draft set:
# cloning's severity drifts with the corpus). Postgres orders the "Severity" enum by its declaration order
# (CREATE TYPE … AS ENUM ('LOW','MEDIUM','HIGH')), so max() yields HIGH > MEDIUM > LOW. The IS DISTINCT FROM
# guard bumps "updatedAt" only when the severity actually changes, so an idempotent re-detect is inert.
# max() is never NULL here: a Case exists only once it has ≥1 attached finding, and findings are append-only
# (never deleted), so the NOT-NULL "severity" column can't be violated.
_RECOMPUTE_CASE_SEVERITY_SQL = """
UPDATE "Case"
SET "severity" = (SELECT max("severity") FROM "Finding" WHERE "caseId" = %(cid)s),
    "updatedAt" = now()
WHERE "id" = %(cid)s
  AND "severity" IS DISTINCT FROM (SELECT max("severity") FROM "Finding" WHERE "caseId" = %(cid)s)
"""

# Attach every not-yet-attached finding for the episode (idempotent: WHERE caseId IS NULL matches nothing on
# a re-run; also back-fills any pre-aggregation findings). A domain UPDATE, not an OutboxJob transition — so
# it is deliberately NOT lease-fenced.
_ATTACH_FINDINGS_SQL = """
UPDATE "Finding" SET "caseId" = %(cid)s
WHERE "episodeId" = %(ep)s AND "caseId" IS NULL
"""

_INSERT_AUDIT_EVENT_SQL = """
INSERT INTO "AuditEvent" ("id", "actor", "action", "targetType", "targetId", "metadata")
VALUES (%(id)s, %(actor)s, %(action)s, %(targetType)s, %(targetId)s, %(metadata)s)
"""


def insert_evidence_links(conn: psycopg.Connection, links: list[EvidenceLinkDraft]) -> None:
    """Insert each ``bertentangan`` link idempotently (WHERE NOT EXISTS). The relation is hard-coded in the
    SQL (a detector may only write ``bertentangan``). NEVER inspects rowcount — a skip is success (same
    discipline as insert_findings). No-op when ``links`` is empty."""
    for link in links:
        conn.execute(
            _INSERT_EVIDENCE_LINK_SQL,
            {
                "id": uuid.uuid4().hex,
                "ev": link.evidence_id,
                "cv": link.claim_version_id,
                "note": link.note,
            },
        )


def upsert_case(conn: psycopg.Connection, episode_id: str, seed_severity: Severity) -> str:
    """Find-or-create the episode's Case; return its (stable) id. ``seed_severity`` is only the NOT-NULL
    seed for a first insert — call ``recompute_case_severity`` after attaching findings for the real value."""
    return conn.execute(
        _UPSERT_CASE_SQL,
        {"id": uuid.uuid4().hex, "ep": episode_id, "severity": str(seed_severity)},
    ).fetchone()["id"]


def attach_findings_to_case(conn: psycopg.Connection, episode_id: str, case_id: str) -> None:
    """Attach the episode's not-yet-attached findings to the Case (idempotent; also back-fills older ones)."""
    conn.execute(_ATTACH_FINDINGS_SQL, {"cid": case_id, "ep": episode_id})


def recompute_case_severity(conn: psycopg.Connection, case_id: str) -> None:
    """Set Case.severity = max over its attached findings. Call after ``attach_findings_to_case``."""
    conn.execute(_RECOMPUTE_CASE_SEVERITY_SQL, {"cid": case_id})


def insert_audit_event(
    conn: psycopg.Connection,
    *,
    actor: str,
    action: str,
    target_type: str,
    target_id: str,
    metadata: dict[str, Any],
) -> None:
    """INSERT one AuditEvent (append-only — the worker only ever inserts). ``metadata`` wrapped with Jsonb."""
    conn.execute(
        _INSERT_AUDIT_EVENT_SQL,
        {
            "id": uuid.uuid4().hex,
            "actor": actor,
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "metadata": Jsonb(metadata),
        },
    )


# --- Job terminal/requeue transitions (lease-fenced) --------------------------------------------

# Every terminal/requeue UPDATE fences on the lease owner. The caller MUST check rowcount: 0 means the lease
# was lost (reaper + peer) → raise LeaseLostError so the enclosing write tx (incl. any findings) rolls back.
_FENCE = 'WHERE "id" = %(id)s AND "status" = \'PROCESSING\' AND "lockedBy" = %(worker)s'

_MARK_DONE_SQL = f"""
UPDATE "OutboxJob"
SET "status" = 'DONE', "lockedBy" = NULL, "lockedAt" = NULL
{_FENCE};
"""

_REQUEUE_SQL = f"""
UPDATE "OutboxJob"
SET "status" = 'PENDING', "attempts" = "attempts" + 1, "lockedBy" = NULL, "lockedAt" = NULL
{_FENCE};
"""

_FAIL_SQL = f"""
UPDATE "OutboxJob"
SET "status" = 'FAILED', "attempts" = "attempts" + 1
{_FENCE};
"""


def mark_done(conn: psycopg.Connection, job_id: str, worker_id: str) -> None:
    """Mark the job DONE. Raises LeaseLostError (rolling back the tx) if this worker no longer owns it."""
    cur = conn.execute(_MARK_DONE_SQL, {"id": job_id, "worker": worker_id})
    if cur.rowcount == 0:
        raise LeaseLostError(job_id)


def requeue(conn: psycopg.Connection, job_id: str, worker_id: str) -> bool:
    """Requeue to PENDING (attempts+1). Returns False if the lease was lost (no-op)."""
    return conn.execute(_REQUEUE_SQL, {"id": job_id, "worker": worker_id}).rowcount > 0


def mark_failed(conn: psycopg.Connection, job_id: str, worker_id: str) -> bool:
    """Mark FAILED (attempts+1). Returns False if the lease was lost (no-op)."""
    return conn.execute(_FAIL_SQL, {"id": job_id, "worker": worker_id}).rowcount > 0
