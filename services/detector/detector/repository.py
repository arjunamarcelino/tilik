"""All SQL the worker issues. Centralised here so identifier-quoting and the lease-fence invariants live in
one place (and a test can grep this file to prove no SQL is built with string interpolation).

Quoting: every Prisma identifier is camel/PascalCase and MUST be double-quoted. Values are ALWAYS passed as
``%(name)s`` placeholders — never f-strings / ``%`` / ``.format`` / ``+`` (a test enforces this).

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
    Episode,
    EvidenceView,
    FindingDraft,
)

DETECT_EPISODE = "DETECT_EPISODE"  # OutboxJob.type (mirror of @tilik/shared/constants OUTBOX_JOB_TYPE)


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


# --- Load episode (constant 3–4 queries; no N+1) ------------------------------------------------


def load_episode(conn: psycopg.Connection, episode_id: str) -> Episode | None:
    """Load the episode + all its claim versions (+lines) + evidence. Returns None if the episode is gone."""
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
    lines_by_claim: dict[str, list[ClaimLineView]] = {}
    for r in line_rows:
        lines_by_claim.setdefault(r["claimVersionId"], []).append(
            ClaimLineView(
                type=r["type"], code=r["code"], sequence=r["sequence"],
                description=r["description"], amount=r["amount"],
            )
        )

    evidence_rows = conn.execute(
        """
        SELECT "id", "kind", "objectKey", "payload", "contentHash", "fingerprint", "capturedAt"
        FROM "EvidenceRecord" WHERE "episodeId" = %(id)s ORDER BY "capturedAt", "id"
        """,
        {"id": episode_id},
    ).fetchall()

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
    return Episode(
        id=ep["id"], patient_token=ep["patientToken"], facility_id=ep["facilityId"],
        started_at=_utc(ep["startedAt"]), ended_at=_utc(ep["endedAt"]),
        import_batch_id=ep["importBatchId"], claims=claims, evidence=evidence,
    )


# --- Findings (write path — shaped for Prompt 08; stub writes nothing today) --------------------


def insert_findings(conn: psycopg.Connection, episode_id: str, drafts: list[FindingDraft]) -> None:
    """Insert Finding rows. ``reasons``/``evidenceRefs`` are wrapped with Jsonb (psycopg won't auto-adapt).

    ``Finding.id`` has no DB default (Prisma mints a cuid client-side), so the id is generated here — a
    uuid, consistent with how the import pipeline mints episode ids. No-op when ``drafts`` is empty.
    """
    for d in drafts:
        conn.execute(
            """
            INSERT INTO "Finding"
                ("id", "episodeId", "claimVersionId", "detector", "score", "severity", "reasons", "evidenceRefs")
            VALUES (%(id)s, %(episodeId)s, %(claimVersionId)s, %(detector)s, %(score)s, %(severity)s,
                    %(reasons)s, %(evidenceRefs)s)
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
