"""DB integration: two workers never double-process one job (FOR UPDATE SKIP LOCKED).

This exercises the real contention: one connection holds an open transaction that has locked the only
PENDING row via ``FOR UPDATE SKIP LOCKED``; while that lock is held, a second connection's ``claim_job``
must SKIP it and get nothing. Once the lock is released, the claim succeeds. That is the exactly-once
guarantee — not merely "a committed row isn't re-claimed."
"""

from __future__ import annotations

from detector import db, repository

_LOCK_HEAD_SQL = """
SELECT "id" FROM "OutboxJob"
WHERE "status" = 'PENDING' AND "type" = 'DETECT_EPISODE'
ORDER BY "createdAt", "id"
FOR UPDATE SKIP LOCKED
LIMIT 1
"""


def test_skip_locked_prevents_double_claim(conn, factory, db_dsn) -> None:
    episode_id = factory.episode()
    job_id = factory.job(episode_id)

    locker = db.connect(db_dsn.value)
    try:
        # Hold the row's lock in an open transaction on `locker`.
        with locker.transaction():
            locked = locker.execute(_LOCK_HEAD_SQL).fetchone()
            assert locked is not None and locked["id"] == job_id

            # While the lock is held, a second worker's claim must skip it → nothing claimable.
            assert repository.claim_job(conn, "worker-B") is None

        # Lock released (transaction committed) → the job is claimable again.
        claimed = repository.claim_job(conn, "worker-B")
        assert claimed is not None and claimed["id"] == job_id
    finally:
        locker.close()

    row = factory.status(job_id)
    assert row["status"] == "PROCESSING"
    assert row["lockedBy"] == "worker-B"
