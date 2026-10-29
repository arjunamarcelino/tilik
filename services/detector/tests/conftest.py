"""Shared fixtures for the DB-backed integration tests.

Isolation is mandatory: the tests seed and claim real ``OutboxJob`` rows, so they must NOT run against a
shared outbox that holds real work. Resolution order for the target DB:

  1. ``DETECTOR_TEST_DATABASE_URL`` — an isolated database (recommended; created by the owner, migrated,
     granted). Used as-is.
  2. ``APP_DATABASE_URL`` — the dev DB, used ONLY if its outbox has zero pending DETECT_EPISODE jobs (so a
     test can never claim real work). Otherwise the DB tests skip with an explanatory message.

If neither is reachable, the DB tests skip (the pure tests — tokenizer, error classification, payload
validation — always run). Values are read from the repo-root ``.env`` when not already in the environment.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from psycopg.types.json import Jsonb

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SEED_STARTED_AT = datetime(2026, 1, 1, 0, 0, 0)  # fixed, naive (DB column is `timestamp` without zone)
# Prefixes for all test-created rows — used both to tag and to sweep orphans from a crashed prior run.
_TEST_ID_PREFIXES = ("test-ep-", "test-job-", "e2e-ep-", "e2e-job-", "linktest-")


@dataclass(frozen=True)
class _Dsn:
    """Wraps the test DSN so a credential never shows up verbatim under ``pytest --showlocals``."""

    value: str

    def __repr__(self) -> str:
        return "<test-dsn redacted>"


def _sweep_orphans(conn) -> None:
    """Delete test-tagged rows left by a crashed prior run so the suite is self-healing. Touches ONLY rows
    whose ids carry a test prefix — never real data. (Append-only evidence/claims can't be deleted by
    tilik_app, so linktest Episodes with evidence may persist; harmless with unique ids.)"""
    conn.execute("DELETE FROM \"OutboxJob\" WHERE \"id\" LIKE 'test-job-%' OR \"id\" LIKE 'e2e-job-%'")
    conn.execute(
        'DELETE FROM "Finding" WHERE "episodeId" IN '
        "(SELECT \"id\" FROM \"Episode\" WHERE \"id\" LIKE 'test-ep-%' OR \"id\" LIKE 'e2e-ep-%')"
    )
    conn.execute("DELETE FROM \"Episode\" WHERE \"id\" LIKE 'test-ep-%' OR \"id\" LIKE 'e2e-ep-%'")


def _load_repo_env() -> None:
    env_path = _REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


@pytest.fixture(scope="session")
def db_dsn() -> _Dsn:
    from detector import db

    _load_repo_env()
    explicit = os.environ.get("DETECTOR_TEST_DATABASE_URL")
    dsn = explicit or os.environ.get("APP_DATABASE_URL")
    if not dsn:
        pytest.skip("no DETECTOR_TEST_DATABASE_URL / APP_DATABASE_URL — skipping DB integration tests")

    try:
        conn = db.connect(dsn)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"database unreachable ({type(exc).__name__}) — skipping DB integration tests")

    try:
        _sweep_orphans(conn)  # self-heal from a crashed prior run before the clean-outbox check below
        pending = conn.execute(
            "SELECT count(*) AS n FROM \"OutboxJob\" WHERE status='PENDING' AND type='DETECT_EPISODE'"
        ).fetchone()["n"]
    finally:
        conn.close()

    if explicit is None and pending > 0:
        pytest.skip(
            f"APP_DATABASE_URL outbox has {pending} pending DETECT_EPISODE jobs — set "
            "DETECTOR_TEST_DATABASE_URL to an isolated DB to run these tests without claiming real work"
        )
    return _Dsn(dsn)


@pytest.fixture
def conn(db_dsn):
    from detector import db

    c = db.connect(db_dsn.value)
    yield c
    c.close()


@pytest.fixture
def factory(conn):
    """Create childless episodes and PENDING DETECT_EPISODE jobs; delete only self-created rows on teardown.

    Childless because ``tilik_app`` has DELETE revoked on ClaimLine/ClaimVersion/EvidenceRecord; it DOES
    have full CRUD on Episode/OutboxJob/Finding, so those teardown cleanly.
    """
    episodes: list[str] = []
    jobs: list[str] = []

    def episode() -> str:
        eid = "test-ep-" + uuid.uuid4().hex
        conn.execute(
            'INSERT INTO "Episode" ("id","patientToken","facilityId","startedAt","updatedAt") '
            "VALUES (%s,%s,%s,%s,%s)",
            (eid, "patient:testtoken", "FAC-TEST", _SEED_STARTED_AT, _SEED_STARTED_AT),
        )
        episodes.append(eid)
        return eid

    def job(episode_id: str, *, v: int = 1) -> str:
        jid = "test-job-" + uuid.uuid4().hex
        payload = Jsonb({"v": v, "episodeId": episode_id, "importBatchId": "test-batch"})
        conn.execute(
            'INSERT INTO "OutboxJob" ("id","type","payload","status") VALUES (%s,%s,%s,%s)',
            (jid, "DETECT_EPISODE", payload, "PENDING"),
        )
        jobs.append(jid)
        return jid

    def status(job_id: str) -> dict:
        return conn.execute(
            'SELECT "status","attempts","lockedBy","lockedAt" FROM "OutboxJob" WHERE "id"=%s', (job_id,)
        ).fetchone()

    yield SimpleNamespace(episode=episode, job=job, status=status)

    for eid in episodes:
        conn.execute('DELETE FROM "Finding" WHERE "episodeId"=%s', (eid,))
    for jid in jobs:
        conn.execute('DELETE FROM "OutboxJob" WHERE "id"=%s', (jid,))
    for eid in episodes:
        conn.execute('DELETE FROM "Episode" WHERE "id"=%s', (eid,))
