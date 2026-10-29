"""Runtime configuration, parsed once from the environment and fail-fast.

Security:
  * reads ``APP_DATABASE_URL`` ONLY — there is deliberately NO ``DATABASE_URL`` (owner) fallback, so no code
    path can connect as the schema owner. A grep guard in the tests enforces that ``DATABASE_URL`` is never
    referenced under ``detector/``.
  * does NOT read ``PATIENT_TOKEN_HMAC_KEY`` — the Prompt 07 worker tokenizes nothing at runtime (the vector
    test supplies the fixture's own key), so the real secret never enters this process. Wiring it is Prompt 08.
  * a redacting ``__repr__`` masks the DSN password, so a "loaded config" log line can never leak credentials.
"""

from __future__ import annotations

import os
import socket
import uuid
from dataclasses import dataclass


class ConfigError(SystemExit):
    """Fatal misconfiguration — exit non-zero at boot rather than run degraded."""


def _redact_dsn(dsn: str) -> str:
    """Mask the password in a ``postgresql://user:pass@host/db`` DSN for safe logging."""
    if "@" not in dsn or "://" not in dsn:
        return "<dsn>"
    scheme, rest = dsn.split("://", 1)
    creds, tail = rest.split("@", 1)
    user = creds.split(":", 1)[0] if ":" in creds else creds
    return f"{scheme}://{user}:***@{tail}"


def _default_worker_id() -> str:
    """Stable, unique-per-instance lease identity: ``host:pid:<uuid8>``.

    Uniqueness matters — the lease fence compares ``OutboxJob.lockedBy = worker_id``; the ``uuid`` suffix
    guarantees two workers on one host never collide.
    """
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


@dataclass(frozen=True)
class Config:
    app_database_url: str
    poll_interval_s: float
    max_attempts: int
    log_level: str
    worker_id: str

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Config:
        env = env if env is not None else dict(os.environ)

        dsn = env.get("APP_DATABASE_URL", "").strip()
        if not dsn:
            raise ConfigError("FATAL: APP_DATABASE_URL is required (non-owner tilik_app connection).")

        poll_ms = _parse_int(env, "DETECTOR_POLL_INTERVAL_MS", 1000, minimum=1)
        max_attempts = _parse_int(env, "DETECTOR_MAX_ATTEMPTS", 5, minimum=1)

        return cls(
            app_database_url=dsn,
            poll_interval_s=poll_ms / 1000.0,
            max_attempts=max_attempts,
            log_level=env.get("LOG_LEVEL", "info").strip().lower() or "info",
            worker_id=env.get("DETECTOR_WORKER_ID", "").strip() or _default_worker_id(),
        )

    def __repr__(self) -> str:  # never render the DSN password
        return (
            f"Config(app_database_url={_redact_dsn(self.app_database_url)!r}, "
            f"poll_interval_s={self.poll_interval_s}, max_attempts={self.max_attempts}, "
            f"log_level={self.log_level!r}, worker_id={self.worker_id!r})"
        )


def _parse_int(env: dict[str, str], key: str, default: int, *, minimum: int) -> int:
    raw = env.get(key, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"FATAL: {key} must be an integer, got {raw!r}.") from exc
    if value < minimum:
        raise ConfigError(f"FATAL: {key} must be >= {minimum}, got {value}.")
    return value
