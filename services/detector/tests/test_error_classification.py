"""Pure tests for the error taxonomy (no DB)."""

from __future__ import annotations

import psycopg

from detector.worker import NonRetryableError, Outcome, classify_error


def test_serialization_failure_is_retry() -> None:
    assert classify_error(psycopg.errors.SerializationFailure("boom")) is Outcome.RETRY


def test_deadlock_is_retry() -> None:
    assert classify_error(psycopg.errors.DeadlockDetected("boom")) is Outcome.RETRY


def test_operational_error_is_reconnect() -> None:
    # Checked AFTER the serialization/deadlock subclasses, which also derive from OperationalError.
    assert classify_error(psycopg.OperationalError("connection reset")) is Outcome.RECONNECT


def test_integrity_error_is_fail() -> None:
    # FK (23503) / CHECK (23514) violations will never succeed on retry.
    assert classify_error(psycopg.errors.ForeignKeyViolation("fk")) is Outcome.FAIL
    assert classify_error(psycopg.errors.CheckViolation("chk")) is Outcome.FAIL


def test_non_retryable_and_unknown_are_fail() -> None:
    assert classify_error(NonRetryableError("bad payload")) is Outcome.FAIL
    assert classify_error(ValueError("unexpected")) is Outcome.FAIL
