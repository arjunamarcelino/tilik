"""DB integration: two workers never double-process one job (FOR UPDATE SKIP LOCKED).

Sequential, not threaded (per the plan): each ``claim_job`` auto-commits its PROCESSING transition, so the
second claim deterministically sees no claimable row. This asserts the exactly-once invariant without
thread-timing flake.
"""

from __future__ import annotations

from detector import db, repository


def test_two_workers_claim_exactly_one(conn, factory, db_dsn) -> None:
    episode_id = factory.episode()
    job_id = factory.job(episode_id)

    other = db.connect(db_dsn)
    try:
        first = repository.claim_job(conn, "worker-A")
        second = repository.claim_job(other, "worker-B")
    finally:
        other.close()

    claimed = [j for j in (first, second) if j is not None]
    assert len(claimed) == 1, "exactly one worker must claim the job"
    assert claimed[0]["id"] == job_id

    row = factory.status(job_id)
    assert row["status"] == "PROCESSING"
    assert row["lockedBy"] in ("worker-A", "worker-B")
