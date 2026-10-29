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
import math
import socket
import uuid
import logging
from dataclasses import dataclass
from urllib.parse import urlsplit


class ConfigError(SystemExit):
    """Fatal misconfiguration — exit non-zero at boot rather than run degraded."""


# Detector tuning. The two values genuinely worth tuning at the demo (the repeat-billing exception set — the
# precision mechanism — and the cloning cosine threshold) are env-configurable on Config below. The rest
# (cloning severity cutoff, min corpus) are named module constants: never asserted downstream, never retuned
# at runtime, so a constant satisfies "no magic numbers" without the env field + parser + docs overhead.
_DEFAULT_REPEAT_EXCEPTION_CODES = frozenset({"39.95", "99.25"})  # hemodialysis, chemotherapy — legitimately repeatable
_DEFAULT_CLONING_THRESHOLD = 0.85  # positives (clones) cluster ~0.97–1.0, negatives (SOAP) ~0.4–0.6 → 0.85 sits in the gap
CLONING_HIGH_CUTOFF = 0.95  # cosine at/above which a CLONING finding is HIGH severity (else MEDIUM)
# Min comparison corpus before cloning runs. This floor is set by the max_df filter, NOT just idf stability:
# a k-member clone's distinctive terms have document frequency k (current + k-1 siblings), so they survive
# the max_df prune only when k <= CLONING_MAX_DF * N (N = corpus + 1 doc). For the minimal 2-member clone
# (k=2) that needs N >= 2/0.15 ≈ 14, i.e. a corpus of >= 13 — below that the shared content is pruned and
# NO clone can ever be detected. So the floor is 13, not an arbitrary small number; larger clusters need
# proportionally more corpus (k <= max_df * N). Below the floor, detect_cloning returns [] (fail-safe).
CLONING_MIN_CORPUS = 13
# Drop terms appearing in MORE than this fraction of the corpus before comparing. This — NOT idf — is what
# separates "copied distinctive content" (flagged) from "shared standardized structure" (not): a plain cosine
# scores two identical SOAP forms 1.0 regardless of idf (idf cancels in the ratio), so exact-duplicate
# templates would over-flag; filtering corpus-common terms leaves only distinctive content. Corpus-relative
# (a fraction), so it holds as the corpus grows. Verified against the Prompt 04 manifest: a fraud clone's
# distinctive clinical terms sit in ~9% of narratives (survive) while a SOAP template's scaffold AND its
# low-cardinality complaint/vitals text are corpus-common (filtered) → clones ≈1.0, templates/clean ≈0.
# This is the single most behaviourally load-bearing knob, yet it is a module constant, not env-tunable: the
# config surface is kept deliberately minimal (only the two values a demo operator would actually retune are
# env — the threshold and the exception set), and changing max_df is a code change gated by a regression test
# (tests/test_cloning.py::test_clone_fires_at_the_minimum_working_corpus), not a runtime dial.
CLONING_MAX_DF = 0.15


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
    # Detector tuning (defaulted so test helpers / direct construction need not supply them).
    repeat_exception_codes: frozenset[str] = _DEFAULT_REPEAT_EXCEPTION_CODES
    cloning_threshold: float = _DEFAULT_CLONING_THRESHOLD

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Config:
        env = env if env is not None else dict(os.environ)

        dsn = env.get("APP_DATABASE_URL", "").strip()
        if not dsn:
            raise ConfigError("FATAL: APP_DATABASE_URL is required (non-owner tilik_app connection).")

        poll_ms = _parse_int(env, "DETECTOR_POLL_INTERVAL_MS", 1000, minimum=1)
        max_attempts = _parse_int(env, "DETECTOR_MAX_ATTEMPTS", 5, minimum=1)
        log_level = _parse_log_level(env)

        cloning_threshold = _parse_float(
            env, "DETECTOR_CLONING_THRESHOLD", _DEFAULT_CLONING_THRESHOLD, lo=0.0, hi=1.0
        )
        if cloning_threshold == 0.0:
            raise ConfigError(
                "FATAL: DETECTOR_CLONING_THRESHOLD must be > 0 — a 0 cosine threshold flags every pair."
            )

        return cls(
            app_database_url=dsn,
            poll_interval_s=poll_ms / 1000.0,
            max_attempts=max_attempts,
            log_level=log_level,
            worker_id=env.get("DETECTOR_WORKER_ID", "").strip() or _default_worker_id(),
            repeat_exception_codes=_parse_code_set(
                env, "DETECTOR_REPEAT_EXCEPTION_CODES", _DEFAULT_REPEAT_EXCEPTION_CODES
            ),
            cloning_threshold=cloning_threshold,
        )

    def __repr__(self) -> str:  # never render the DSN password
        return (
            f"Config(app_database_url={_redact_dsn(self.app_database_url)!r}, "
            f"poll_interval_s={self.poll_interval_s}, max_attempts={self.max_attempts}, "
            f"log_level={self.log_level!r}, worker_id={self.worker_id!r}, "
            f"repeat_exception_codes={sorted(self.repeat_exception_codes)!r}, "
            f"cloning_threshold={self.cloning_threshold})"
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


def _parse_float(env: dict[str, str], key: str, default: float, *, lo: float, hi: float) -> float:
    """Parse a bounded float, fail-fast. Rejects NaN/inf explicitly: ``float("nan")`` parses without error
    and clears any ``lo <= v <= hi`` check (every comparison with NaN is False), so a ``…=nan`` threshold
    would silently flag nothing — exactly the degraded-but-booted state this config is meant to prevent."""
    raw = env.get(key, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"FATAL: {key} must be a number, got {raw!r}.") from exc
    if not math.isfinite(value):
        raise ConfigError(f"FATAL: {key} must be a finite number, got {raw!r}.")
    if value < lo or value > hi:
        raise ConfigError(f"FATAL: {key} must be in [{lo}, {hi}], got {value}.")
    return value


def _parse_code_set(env: dict[str, str], key: str, default: frozenset[str]) -> frozenset[str]:
    """Parse a comma-separated code set. Codes carry dots (ICD-9-CM, e.g. ``39.95``) — kept as strings, no
    numeric coercion. Distinguishes *unset* (key absent → the default set) from *explicitly empty*
    (``DETECTOR_REPEAT_EXCEPTION_CODES=`` → the operator opts out of all exceptions, honoured as an empty
    set) — collapsing the two would make the exception list impossible to disable."""
    raw = env.get(key)
    if raw is None:
        return default
    return frozenset(code.strip() for code in raw.split(",") if code.strip())


def _parse_log_level(env: dict[str, str]) -> str:
    """Validate LOG_LEVEL at config time so a bad value fails fast as ConfigError, not a late ValueError
    out of ``logging.setLevel``."""
    raw = env.get("LOG_LEVEL", "info").strip().lower() or "info"
    valid = {name.lower() for name in logging.getLevelNamesMapping()}  # 3.11+
    if raw not in valid:
        raise ConfigError(f"FATAL: LOG_LEVEL must be one of {sorted(valid)}, got {raw!r}.")
    return raw
