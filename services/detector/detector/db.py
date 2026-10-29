"""Postgres connectivity for the worker — non-owner, fail-closed.

The worker connects as the NON-OWNER ``tilik_app`` role (``APP_DATABASE_URL``) so the append-only grant
actually binds, mirroring the API's ``PrismaService`` boot assertion. It NEVER runs migrations — Prisma owns
the schema. A single long-lived connection is used (a pool buys nothing for a single-threaded poller);
``autocommit=True`` avoids the psycopg "idle in transaction" trap, and the one place that needs atomicity
(findings-insert + mark-DONE) opens an explicit ``with conn.transaction():`` block.
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

EXPECTED_ROLE = "tilik_app"

# statement_timeout: 30s; lock_timeout: 10s — bound any single statement so "finish in-flight" on shutdown
# can't hang past the orchestrator grace.
_BASE_OPTIONS = "-c statement_timeout=30000 -c lock_timeout=10000"

# Surface a dropped socket as an OperationalError promptly (not after the multi-minute OS TCP timeout).
_CONN_KWARGS = {
    "autocommit": True,
    "row_factory": dict_row,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 5,
}


class NotAppRoleError(RuntimeError):
    """We connected as the wrong Postgres role — the append-only guarantee would not bind."""


def normalize_dsn(dsn: str) -> tuple[str, str]:
    """Return (libpq-safe DSN, options) from a Prisma-style URL.

    Handles the ONE Prisma-only query param this repo's ``APP_DATABASE_URL`` carries — ``schema`` — which
    libpq/psycopg reject: it is stripped and translated to a ``search_path`` in the session ``options``
    (merged with the statement/lock timeouts). Other Prisma-only params (``connection_limit``,
    ``pool_timeout``, ``pgbouncer``) are NOT handled and would still reach libpq; add them here if a future
    DSN carries them. The owner and app both use the ``public`` schema, so this keeps the detector reading
    the same tables Prisma created.
    """
    parts = urlsplit(dsn)
    query = parse_qsl(parts.query, keep_blank_values=True)
    schema = next((v for k, v in query if k == "schema"), None)
    kept = [(k, v) for k, v in query if k != "schema"]
    safe_dsn = urlunsplit(parts._replace(query=urlencode(kept)))
    options = _BASE_OPTIONS
    if schema:
        options = f"{options} -c search_path={schema}"
    return safe_dsn, options


def connect(dsn: str) -> psycopg.Connection:
    """Open a connection and assert we are the non-owner role before returning it."""
    safe_dsn, options = normalize_dsn(dsn)
    conn = psycopg.connect(safe_dsn, options=options, **_CONN_KWARGS)
    try:
        assert_non_owner(conn)
    except Exception:
        conn.close()
        raise
    return conn


def assert_non_owner(conn: psycopg.Connection) -> None:
    """Fail closed unless ``current_user = 'tilik_app'`` (mirror of apps/api PrismaService)."""
    row = conn.execute("SELECT current_user AS role").fetchone()
    role = row["role"] if row else None
    if role != EXPECTED_ROLE:
        raise NotAppRoleError(
            f"connected to Postgres as {role!r}, expected {EXPECTED_ROLE!r} — "
            "the append-only guarantee would not bind. Check APP_DATABASE_URL."
        )
