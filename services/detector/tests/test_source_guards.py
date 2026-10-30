"""Source-level regression guards for the two highest-stakes invariants (pure — no DB).

These enforce what config.py/repository.py document: the worker never reads the owner DATABASE_URL, and SQL
is built from static text + bound placeholders only (no value interpolation). They are deliberately simple
so a future diff that reintroduces either foot-gun fails CI rather than passing unreviewed.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

from detector import repository

_PKG_DIR = Path(__file__).resolve().parents[1] / "detector"


def test_no_owner_database_url_key_in_source() -> None:
    # Owner connections use DATABASE_URL; the worker must only ever read APP_DATABASE_URL /
    # DETECTOR_TEST_DATABASE_URL. Match the *quoted env key* so prose/docstrings mentioning the name are
    # not flagged, and the APP_/DETECTOR_TEST_ prefixes (preceded by `_`, not a quote) don't match.
    bare_key = re.compile(r"""['"]DATABASE_URL['"]""")
    offenders = [p.name for p in _PKG_DIR.glob("*.py") if bare_key.search(p.read_text(encoding="utf-8"))]
    assert not offenders, f"owner DATABASE_URL key referenced under detector/: {offenders}"


def test_sql_constants_are_placeholder_only() -> None:
    # The resolved SQL constants must carry only %(name)s bind placeholders and no leftover f-string braces
    # (the one sanctioned f-string composes the static _FENCE fragment, which contains placeholders only).
    #
    # Discover the constants by naming convention (module-level `*_SQL` strings, plus the `_FENCE` fragment)
    # rather than a hand-maintained list, so a newly-added SQL constant can't silently escape this guard.
    sql_constants = {
        name: value
        for name, value in vars(repository).items()
        if isinstance(value, str) and (name.endswith("_SQL") or name == "_FENCE")
    }
    # Sanity: discovery actually found the known constants (so a convention change can't vacuously pass).
    assert {"_CLAIM_SQL", "_INSERT_EVIDENCE_LINK_SQL", "_INSERT_AUDIT_EVENT_SQL", "_FENCE"} <= sql_constants.keys()
    for name, sql in sql_constants.items():
        assert "{" not in sql and "}" not in sql, f"{name} has an unresolved interpolation brace"
        assert "%(" in sql, f"{name} should bind values via %(name)s placeholders"


def test_repository_builds_no_sql_with_string_formatting() -> None:
    # No .format()/%-formatting is used to assemble SQL (the only interpolation is the f-string _FENCE
    # compose, which uses no values). A future value-interpolated query must use %(name)s binds instead.
    src = inspect.getsource(repository)
    assert ".format(" not in src, "repository.py must not build SQL with str.format()"
