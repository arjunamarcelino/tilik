"""Structured JSON logging to stdout, stdlib only.

Named ``log`` (not ``logging``) to avoid shadowing the stdlib module. One JSON object per line via a
``logging.Formatter`` subclass, so a log collector can ingest it directly and ``LOG_LEVEL`` filtering is free.

Hard rule — callers MUST NOT log secrets or sensitive content: never the HMAC key, the DSN, ``patient_token``,
``facility_id``, loaded domain objects, amounts, codes, descriptions, or raw payloads. Pass only opaque
surrogate ids (``job_id``, ``episode_id``, ``import_batch_id``) via ``extra=``. The ``Episode``/``*View``
dataclasses have redacting ``__repr__``s as a second line of defence.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

# Standard LogRecord attributes — everything else in ``record.__dict__`` is caller context from ``extra=``.
_RESERVED = frozenset(
    logging.makeLogRecord({}).__dict__.keys()
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    """Serialise each record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        # Explicit UTC ISO-8601 (…Z), not local-time-with-offset — collectors shouldn't have to guess the zone.
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds")
        payload: dict[str, Any] = {
            "ts": ts.replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
        }
        # Copy caller-supplied context (extra=), skipping reserved attribute names.
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            # stdlib formatter — does NOT include frame locals, so no sensitive content leaks.
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class _WorkerAdapter(logging.LoggerAdapter):
    """Bind constant context (worker_id) while PRESERVING per-call ``extra=``.

    Stdlib ``LoggerAdapter.process`` overwrites the caller's ``extra`` with the adapter's, which would drop
    ``job_id``/``episode_id``/… from every line. Merge instead (per-call keys win). Done by hand rather than
    3.13's ``merge_extra=True`` so the 3.11 ``requires-python`` floor still works.
    """

    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        kwargs["extra"] = {**(self.extra or {}), **(kwargs.get("extra") or {})}
        return msg, kwargs


def configure(level: str, worker_id: str) -> logging.LoggerAdapter:
    """Install the JSON handler on the ``detector`` logger and bind the worker id to every line."""
    logger = logging.getLogger("detector")
    logger.setLevel(level.upper())
    logger.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    # worker_id is constant for the process → bind it once; per-call extra= is merged on top.
    return _WorkerAdapter(logger, {"worker_id": worker_id})
