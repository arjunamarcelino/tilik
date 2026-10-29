"""Runtime configuration, parsed once from the environment and fail-fast.

Security:
  * reads ``APP_DATABASE_URL`` ONLY — there is deliberately NO ``DATABASE_URL`` (owner) fallback, so no code
    path can connect as the schema owner. Enforced by
    ``tests/test_source_guards.py::test_no_owner_database_url_key_in_source``.
  * does NOT read ``PATIENT_TOKEN_HMAC_KEY`` — the Prompt 07 worker tokenizes nothing at runtime (the vector
    test supplies the fixture's own key), so the real secret never enters this process. Wiring it is Prompt 08.
  * a redacting ``__repr__`` masks the DSN password, so a "loaded config" log line can never leak credentials.
"""

from __future__ import annotations

import os
import socket
import uuid
import logging
from dataclasses import dataclass
from urllib.parse import urlsplit


class ConfigError(SystemExit):
    """Fatal misconfiguration — exit non-zero at boot rather than run degraded."""


def _redact_dsn(dsn: str) -> str:
    """Mask the password in a ``postgresql://user:pass@host/db`` DSN for safe logging.

    Parses via ``urlsplit`` and drops the query string entirely (so a ``?password=`` can't leak), rebuilding
    only scheme/user/host/port/path. Assumes an RFC-compliant DSN where any ``@``/``:`` in the password is
    percent-encoded (the valid-URL contract libpq itself requires); on an unparseable value it returns a
    bare ``"<dsn>"``. Defence-in-depth — the DSN is not logged anywhere today.
    """
    try:
        parts = urlsplit(dsn)
    except ValueError:
        return "<dsn>"
    if not parts.hostname:
        return "<dsn>"
    userinfo = parts.username or ""
    if parts.password:
        userinfo = f"{userinfo}:***"
    hostport = parts.hostname + (f":{parts.port}" if parts.port else "")
    prefix = f"{userinfo}@" if userinfo else ""
    return f"{parts.scheme}://{prefix}{hostport}{parts.path}"


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
        log_level = _parse_log_level(env)

        return cls(
            app_database_url=dsn,
            poll_interval_s=poll_ms / 1000.0,
            max_attempts=max_attempts,
            log_level=log_level,
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


def _parse_log_level(env: dict[str, str]) -> str:
    """Validate LOG_LEVEL at config time so a bad value fails fast as ConfigError, not a late ValueError
    out of ``logging.setLevel``."""
    raw = env.get("LOG_LEVEL", "info").strip().lower() or "info"
    valid = {name.lower() for name in logging.getLevelNamesMapping()}  # 3.11+
    if raw not in valid:
        raise ConfigError(f"FATAL: LOG_LEVEL must be one of {sorted(valid)}, got {raw!r}.")
    return raw
