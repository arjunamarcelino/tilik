"""No-PII guard: scan JSON-ish structures and file bytes for identifier-shaped digit runs.

This is the cross-cutting safety concern extracted out of the bundle accumulator. The Faker allow-list
facade (see gen.py) is the *primary* defence against emitting real addresses/phones/names; the digit scan
here is the identifier-*shape* backstop, run over the exact bytes before anything is written.
"""

from __future__ import annotations

import re


class GuardError(Exception):
    """Raised when the bundle would leak a real-looking identifier (or violate an invariant)."""


# 12+ digits allowing a single separator between each — catches grouped NIK/NPWP/BPJS/phone/KK
# (e.g. "3173 0522 0890 0001", "09.254.294.3-407.000", "3173/0522/0890/0001", "1,234,567,890,123").
# Unanchored so embedded runs also hit. Used on JSON/narrative text, where free-form human identifiers
# would appear.
_DIGIT_RUN = re.compile(r"\d(?:[ .,\-/]?\d){11,}")
# Contiguous 12+ digits only — used on binary file bytes, whose structure legitimately contains
# space-separated digit groups (e.g. a PDF xref table's zero-padded offsets). Our generated files only
# embed the (validated) evidence ref + a fixed title, so a grouped identifier can't originate there.
_DIGIT_RUN_CONTIG = re.compile(r"\d{12,}")
# A validated Decimal(14,2) string, exempt from the digit scan (up to 12 integer digits is legal).
_AMOUNT = re.compile(r"^\d{1,12}\.\d{2}$")


def scan_text(text: str, where: str) -> None:
    m = _DIGIT_RUN.search(text)
    if m:
        raise GuardError(f"possible real identifier {m.group()!r} at {where}")


def scan(obj: object, where: str) -> None:
    """Recursively scan a JSON-ish structure for identifier-shaped runs (keys too, fail-closed)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            scan_text(str(k), f"{where}.{k} (key)")
            # Skip the digit scan only for a *validated* amount (Decimal(14,2) can be up to 12 digits).
            # Any other value under an 'amount' key still gets scanned, so a PII-shaped value can't hide there.
            if k == "amount" and isinstance(v, str) and _AMOUNT.match(v):
                continue
            scan(v, f"{where}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            scan(v, f"{where}[{i}]")
    elif isinstance(obj, str):
        scan_text(obj, where)
    elif isinstance(obj, bool) or obj is None:
        return  # booleans / null carry no digits (bool before int: bool is an int subclass)
    elif isinstance(obj, (int, float)):
        # Integers serialize to raw digits on disk (e.g. an identifier-shaped --seed in manifest.generator),
        # so scan their string form too — the early-return here was the int-bypass hole.
        scan_text(str(obj), where)
    else:  # fail-closed on anything the walker doesn't recognize
        raise GuardError(f"unscannable type {type(obj).__name__} at {where}")


def scan_bytes(data: bytes, where: str) -> None:
    # Scans compressed/hashed binary as latin-1 text for contiguous digit runs. This is safe only because
    # generated files embed just the (validated) ref + a fixed title — if file content ever carries
    # free-form text, revisit this (a pathological run in binary could also fail-closed for some seeds).
    text = data.decode("latin-1", errors="replace")
    m = _DIGIT_RUN_CONTIG.search(text)
    if m:
        raise GuardError(f"possible real identifier {m.group()!r} in file bytes at {where}")
