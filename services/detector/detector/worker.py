"""The polling worker: claim → validate → load → detect → write+DONE, with safe failure handling.

Entrypoint: ``python -m detector.worker`` (or the ``tilik-detector`` console script).

Structure is carved into pure, DB-free seams so most of the logic is unit-testable without Postgres:
  * ``classify_error(exc)`` — maps an exception to RETRY / FAIL / RECONNECT,
  * ``validate_payload(payload)`` — extracts the opaque ``episodeId`` or raises ``NonRetryableError``,
  * ``run_once(conn, cfg, logger)`` — a single claim+process iteration (the unit tests drive this),
wrapped by ``run_forever(...)`` for the drain/sleep/reconnect/signal loop.

Claim-then-release: the claim commits ``PROCESSING`` in its own (autocommit) statement; detection runs
between transactions; findings-insert + mark-DONE share ONE transaction, lease-fenced so a Prompt 08 reaper
cannot cause a double-insert.
"""

from __future__ import annotations

import signal
import threading
import logging
from collections.abc import Sequence
from enum import StrEnum, auto
from typing import Any, Callable

import psycopg

from . import db, log, repository
from .config import Config
from .detectors import run_detectors
from .models import CloneDoc, Episode, FindingDraft

Logger = logging.LoggerAdapter | logging.Logger
Detect = Callable[[Episode, Sequence[CloneDoc], Config], list[FindingDraft]]
LoadCorpus = Callable[[psycopg.Connection, str], list[CloneDoc]]


class NonRetryableError(RuntimeError):
    """A permanent error — the job will never succeed (bad payload, missing episode). Go straight to FAILED."""


class Outcome(StrEnum):
    RETRY = auto()      # transient (serialization/deadlock) — requeue until MAX, then FAIL
    FAIL = auto()       # permanent — mark FAILED now
    RECONNECT = auto()  # connection lost — reconnect; job is left for the reaper


class Tick(StrEnum):
    IDLE = auto()        # no job was claimable → sleep the poll interval
    PROGRESSED = auto()  # a job reached a terminal state → drain immediately
    REQUEUED = auto()    # a job was requeued → wait the poll interval before polling again (no instant re-claim)


def classify_error(exc: Exception) -> Outcome:
    """Classify by exception type (never message text). SerializationFailure/DeadlockDetected subclass
    OperationalError, so they MUST be checked first."""
    if isinstance(exc, (psycopg.errors.SerializationFailure, psycopg.errors.DeadlockDetected)):
        return Outcome.RETRY
    if isinstance(exc, psycopg.OperationalError):
        return Outcome.RECONNECT
    # IntegrityError (FK 23503, CHECK 23514), NonRetryableError, and anything unexpected → permanent.
    return Outcome.FAIL


def validate_payload(payload: Any) -> str:
    """Return the opaque ``episodeId`` from a DETECT_EPISODE payload, or raise ``NonRetryableError``.

    Contract: ``{v: 1, episodeId: <str>, importBatchId: <str>}``. ``v`` must be exactly 1 (unknown versions
    fail fast — never guess); ``episodeId`` must be a non-empty string and is treated as opaque (not parsed).
    """
    if not isinstance(payload, dict):
        raise NonRetryableError(f"payload is not an object: {type(payload).__name__}")
    if payload.get("v") != 1:
        raise NonRetryableError(f"unsupported payload version: {payload.get('v')!r}")
    episode_id = payload.get("episodeId")
    if not isinstance(episode_id, str) or not episode_id:
        raise NonRetryableError("payload missing a non-empty 'episodeId'")
    return episode_id


def run_once(
    conn: psycopg.Connection,
    cfg: Config,
    logger: Logger,
    *,
    detect: Detect = run_detectors,
    load_corpus: LoadCorpus = repository.load_clone_corpus,
) -> Tick:
    """Claim and process at most one job. Returns a ``Tick`` telling the loop whether to drain or sleep.

    Reconnect-class errors propagate to the caller (the connection is unusable). All other errors are
    classified and resolved against the job here. ``detect``/``load_corpus`` are injectable seams so the
    loop logic is unit-drivable without real detection or a populated corpus.
    """
    job = repository.claim_job(conn, cfg.worker_id)
    if job is None:
        return Tick.IDLE

    job_id: str = job["id"]
    ctx = {"job_id": job_id}
    try:
        episode_id = validate_payload(job["payload"])
        ctx["episode_id"] = episode_id
        episode = repository.load_episode(conn, episode_id)
        if episode is None:
            raise NonRetryableError(f"episode not found for job (episode_id={episode_id})")

        # Corpus load is a SEPARATE autocommit read (not inside load_episode's REPEATABLE READ snapshot),
        # keeping detection between transactions — the cloning detector compares against it.
        corpus = load_corpus(conn, episode_id)
        drafts = detect(episode, corpus, cfg)
        # Findings-insert + mark-DONE in ONE transaction. mark_done raises LeaseLostError (rolling back the
        # insert) if a reaper preempted this worker — neither success nor failure.
        with conn.transaction():
            repository.insert_findings(conn, episode_id, drafts)
            repository.mark_done(conn, job_id, cfg.worker_id)
        logger.info("job done", extra={**ctx, "findings": len(drafts)})
        return Tick.PROGRESSED
    except repository.LeaseLostError:
        logger.warning("job lease lost (preempted) — discarded", extra=ctx)
        return Tick.PROGRESSED
    except Exception as exc:  # classify application errors against the job; control-flow exceptions propagate
        return _resolve_failure(conn, cfg, logger, job, exc, ctx)


def _resolve_failure(
    conn: psycopg.Connection,
    cfg: Config,
    logger: Logger,
    job: dict[str, Any],
    exc: Exception,
    ctx: dict[str, Any],
) -> Tick:
    outcome = classify_error(exc)
    if outcome is Outcome.RECONNECT:
        raise exc  # bubble to run_forever; the PROCESSING row is left for the Prompt 08 reaper

    job_id = job["id"]
    attempts_after = job["attempts"] + 1
    err_ctx = {**ctx, "attempts": attempts_after, "error_type": type(exc).__name__,
               "sqlstate": getattr(exc, "sqlstate", None)}

    if outcome is Outcome.RETRY and attempts_after < cfg.max_attempts:
        if repository.requeue(conn, job_id, cfg.worker_id):
            logger.warning("job requeued (will retry)", extra=err_ctx)
            return Tick.REQUEUED
        logger.warning("job lease lost on requeue — discarded", extra=err_ctx)
        return Tick.PROGRESSED

    if repository.mark_failed(conn, job_id, cfg.worker_id):
        # Don't attach exc_info for psycopg errors: the server message/DETAIL can echo row values (clinical
        # content once detectors write Findings). error_type + sqlstate in err_ctx are enough; keep the
        # traceback only for logic errors (ValueError/NonRetryableError), whose messages we control.
        db_error = isinstance(exc, psycopg.Error)
        logger.error("job failed", extra=err_ctx, exc_info=None if db_error else exc)
    else:
        logger.warning("job lease lost on fail — discarded", extra=err_ctx)
    return Tick.PROGRESSED


def run_forever(
    cfg: Config,
    stop_event: threading.Event,
    logger: Logger,
    *,
    connect: Callable[[str], psycopg.Connection] = db.connect,
) -> None:
    """Drain the outbox until ``stop_event`` is set, reconnecting on transient connection loss."""
    conn: psycopg.Connection | None = None
    reconnect_attempt = 0
    while not stop_event.is_set():
        try:
            if conn is None or conn.closed:
                reconnect_attempt += 1
                if reconnect_attempt > 1:
                    logger.warning("reconnecting to database", extra={"reconnect_attempt": reconnect_attempt})
                conn = connect(cfg.app_database_url)
                reconnect_attempt = 0
            tick = run_once(conn, cfg, logger)
            if tick is Tick.PROGRESSED:
                continue  # drain back-to-back; stop is re-checked at the loop top
            stop_event.wait(cfg.poll_interval_s)  # IDLE or REQUEUED → wait (interruptible)
        except psycopg.OperationalError as exc:
            logger.warning("database connection lost", extra={"error_type": type(exc).__name__})
            _safe_close(conn)
            conn = None
            stop_event.wait(cfg.poll_interval_s)
    _safe_close(conn)


def _safe_close(conn: psycopg.Connection | None) -> None:
    if conn is not None and not conn.closed:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 — best-effort on shutdown
            pass


def main(argv: list[str] | None = None) -> int:
    cfg = Config.from_env()
    logger = log.configure(cfg.log_level, cfg.worker_id)
    stop_event = threading.Event()

    def _handle_signal(signum, _frame):  # installed in main(), never at import (process-global state)
        logger.info("shutdown signal received", extra={"signal": signal.Signals(signum).name})
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _handle_signal)

    logger.info(
        "detector worker started",
        extra={"poll_interval_s": cfg.poll_interval_s, "max_attempts": cfg.max_attempts},
    )
    run_forever(cfg, stop_event, logger)
    logger.info("detector worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
