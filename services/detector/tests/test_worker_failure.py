"""DB integration: failure handling — requeue-until-MAX, immediate FAIL, and episode-not-found."""

from __future__ import annotations

import psycopg
from _helpers import make_config, test_logger

from detector.worker import Tick, run_once


def _raise_retryable(_episode, _corpus, _cfg):
    raise psycopg.errors.SerializationFailure("transient — retry me")


def _raise_permanent(_episode, _corpus, _cfg):
    raise ValueError("permanent — do not retry")


def test_retryable_requeues_then_fails_at_max(conn, factory, db_dsn) -> None:
    episode_id = factory.episode()
    job_id = factory.job(episode_id)
    cfg = make_config(db_dsn.value, max_attempts=3)

    # attempts 0 -> 1 (requeue), 1 -> 2 (requeue): status returns to PENDING, lock cleared.
    for expected_attempts in (1, 2):
        tick = run_once(conn, cfg, test_logger, detect=_raise_retryable)
        assert tick is Tick.REQUEUED
        row = factory.status(job_id)
        assert row["status"] == "PENDING"
        assert row["attempts"] == expected_attempts
        assert row["lockedBy"] is None and row["lockedAt"] is None

    # attempts 2 -> 3 == MAX → FAILED.
    tick = run_once(conn, cfg, test_logger, detect=_raise_retryable)
    assert tick is Tick.PROGRESSED
    row = factory.status(job_id)
    assert row["status"] == "FAILED"
    assert row["attempts"] == 3


def test_non_retryable_fails_immediately(conn, factory, db_dsn) -> None:
    episode_id = factory.episode()
    job_id = factory.job(episode_id)

    tick = run_once(conn, make_config(db_dsn.value), test_logger, detect=_raise_permanent)

    assert tick is Tick.PROGRESSED
    row = factory.status(job_id)
    assert row["status"] == "FAILED"
    assert row["attempts"] == 1  # no retry burn


def test_episode_not_found_fails_without_retry(conn, factory, db_dsn) -> None:
    # Job whose payload points at an episode that does not exist → non-retryable → FAILED immediately.
    job_id = factory.job("ep-does-not-exist-" + "0" * 8)

    tick = run_once(conn, make_config(db_dsn.value), test_logger)

    assert tick is Tick.PROGRESSED
    row = factory.status(job_id)
    assert row["status"] == "FAILED"
    assert row["attempts"] == 1
