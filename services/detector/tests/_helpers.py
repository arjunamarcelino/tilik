"""Small helpers shared by the detector tests."""

from __future__ import annotations

import logging
import uuid

from detector.config import Config

# A quiet logger — the worker only emits via it; tests assert on DB state, not log output.
test_logger = logging.getLogger("detector.test")


def make_config(dsn: str, *, max_attempts: int = 5) -> Config:
    return Config(
        app_database_url=dsn,
        poll_interval_s=0.01,
        max_attempts=max_attempts,
        log_level="info",
        worker_id="test-" + uuid.uuid4().hex[:8],
    )


def detector_config(**overrides) -> Config:
    """A minimal Config for the pure detector tests (the DSN is never connected). Hoisted here so the two
    detector test modules share one definition instead of drifting copies."""
    base = dict(
        app_database_url="unused",
        poll_interval_s=0.01,
        max_attempts=5,
        log_level="info",
        worker_id="test",
    )
    return Config(**{**base, **overrides})
