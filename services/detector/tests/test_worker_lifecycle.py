"""DB integration: a PENDING DETECT_EPISODE job drains to DONE via one worker iteration."""

from __future__ import annotations

from _helpers import make_config, test_logger

from detector.worker import Tick, run_once


def test_pending_to_processing_to_done(conn, factory, db_dsn) -> None:
    episode_id = factory.episode()
    job_id = factory.job(episode_id)
    cfg = make_config(db_dsn.value)

    tick = run_once(conn, cfg, test_logger)

    assert tick is Tick.PROGRESSED
    row = factory.status(job_id)
    assert row["status"] == "DONE"
    assert row["lockedBy"] is None and row["lockedAt"] is None  # lock cleared on terminal
    # The stub emits no findings.
    found = conn.execute('SELECT count(*) AS n FROM "Finding" WHERE "episodeId"=%s', (episode_id,)).fetchone()
    assert found["n"] == 0


def test_idle_when_no_jobs(conn, factory, db_dsn) -> None:
    # An episode with no job → nothing claimable → IDLE (and no job touched).
    factory.episode()
    assert run_once(conn, make_config(db_dsn.value), test_logger) is Tick.IDLE
