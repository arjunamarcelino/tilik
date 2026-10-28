"""Deterministic generation context + binary-file builders.

Everything random flows through one seeded ``Faker`` (via an allow-list facade) and one seeded
``random.Random``. Direct ``rng`` use is restricted to ``randrange``/``randint``/``getrandbits`` and the
``pick`` helper — only ``random.random()``'s stream is guaranteed stable across CPython releases, so we avoid
``choice``/``sample``/``shuffle`` entirely.

Dummy evidence files are built from DEFLATE *stored* (uncompressed) blocks rather than ``zlib.compress``,
whose output varies by linked zlib version — a cross-machine drift the same-machine ``diff`` cannot catch.
"""

from __future__ import annotations

import hashlib
import random
import struct
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, TypeVar

from faker import Faker

T = TypeVar("T")

from . import config

# Faker methods the generator is allowed to call. Everything else raises — this is the real protection
# against emitting a real address / postcode / plate / phone, none of which a digit-regex would catch.
# Kept to exactly what the generator uses (only name()); a tighter allow-list is a tighter PII surface.
_ALLOWED_FAKER = frozenset({"name"})

# Providers that must never be reachable. The allow-list __getattr__ already denies everything not
# explicitly allowed; this list is the defence-in-depth backstop asserted disjoint from the allow-list at
# construction, so a future edit that accidentally allow-lists one of these fails fast.
_FORBIDDEN_FAKER = (
    "ssn",
    "nik",
    "phone_number",
    "msisdn",
    "cellphone_number",
    "email",
    "safe_email",
    "company_email",
    "address",
    "street_address",
    "city",
    "state",
    "postcode",
    "building_number",
    "license_plate",
    "company",
    "credit_card_number",
    "iban",
    "bban",
)


class SafeFaker:
    """Composition wrapper exposing only the allow-listed Faker methods."""

    def __init__(self, locale: str, seed: int):
        # A forbidden provider must never be allow-listed (defence in depth; catches a future edit).
        assert _ALLOWED_FAKER.isdisjoint(_FORBIDDEN_FAKER), "a forbidden Faker provider is on the allow-list"
        self._faker = Faker(locale)
        self._faker.seed_instance(seed)
        # Fail loudly if a NIK-capable extension (e.g. manekin) is ever registered.
        if hasattr(self._faker, "nik"):
            raise RuntimeError("A NIK-capable Faker provider is registered; refusing to generate.")

    def __getattr__(self, name: str) -> Any:
        if name in _ALLOWED_FAKER:
            return getattr(self._faker, name)
        raise AttributeError(
            f"Faker method {name!r} is not on the allow-list (synthetic-PII guard). "
            f"Allowed: {sorted(_ALLOWED_FAKER)}"
        )


@dataclass
class Gen:
    """Seeded generation context threaded through every scenario builder."""

    faker: SafeFaker
    rng: random.Random
    _counters: dict[str, int] = field(default_factory=dict)

    @classmethod
    def create(cls, seed: int) -> "Gen":
        return cls(faker=SafeFaker("id_ID", seed), rng=random.Random(seed))

    def next_ref(self, prefix: str) -> str:
        self._counters[prefix] = self._counters.get(prefix, 0) + 1
        return f"{prefix}_{self._counters[prefix]:04d}"

    def pick(self, seq: Sequence[T]) -> T:
        """Deterministic element pick that avoids random.choice's version-coupled algorithm."""
        return seq[self.rng.randrange(len(seq))]

    def money(self, lo: int, hi: int) -> str:
        """A whole-rupiah amount in [lo, hi] (step 1000), formatted as a Decimal(14,2) string.

        Generated as an integer — no float/Decimal arithmetic ever participates — and capped well under
        12 integer digits so it can never collide with the no-PII digit scan.
        """
        steps = (hi - lo) // 1000
        rupiah = lo + self.rng.randint(0, steps) * 1000
        return f"{rupiah}.00"

    def timestamp(self, *, day_offset: int, hour: int, minute: int = 0) -> str:
        dt = config.BASE_DATE + timedelta(days=day_offset, hours=hour, minutes=minute)
        # Explicit format: tz-aware isoformat() would emit "+00:00", not the "Z" the contract documents.
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    def inacbg(self) -> str:
        cmg = self.pick(config.INACBG_CMG)
        group = self.rng.randint(1, 9)
        case = self.rng.randint(1, 99)
        severity = self.pick(config.INACBG_SEVERITY)
        return f"{cmg}-{group}-{case:02d}-{severity}"


# --- Deterministic binary files ------------------------------------------------------------------


def _zlib_stored(data: bytes) -> bytes:
    """A zlib stream using only DEFLATE stored (uncompressed) blocks — fully spec-determined, so the
    bytes are identical on every platform/zlib version (unlike zlib.compress)."""
    out = bytearray(b"\x78\x01")  # zlib header: CM=8, CINFO=7, FLEVEL=0
    if not data:
        out += b"\x01\x00\x00\xff\xff"
    i = 0
    n = len(data)
    while i < n:
        block = data[i : i + 65535]
        i += len(block)
        out += bytes([1 if i >= n else 0])  # BFINAL, BTYPE=00 (stored)
        out += struct.pack("<H", len(block))  # LEN
        out += struct.pack("<H", len(block) ^ 0xFFFF)  # NLEN
        out += block
    out += struct.pack(">I", zlib.adler32(data) & 0xFFFFFFFF)
    return bytes(out)


def _png_chunk(typ: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)


def png_bytes(ref: str) -> bytes:
    """A tiny valid PNG whose solid colour is derived from ``ref`` (distinct content hash per record)."""
    rgb = hashlib.sha256(ref.encode("ascii")).digest()[:3]
    w = h = 2
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit, colour type 2 (RGB)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))  # filter 0 per scanline
    text = _png_chunk(b"tEXt", b"ref\x00" + ref.encode("ascii"))  # constant content → deterministic
    return sig + _png_chunk(b"IHDR", ihdr) + text + _png_chunk(b"IDAT", _zlib_stored(raw)) + _png_chunk(b"IEND", b"")


def pdf_bytes(ref: str, title: str) -> bytes:
    """A minimal single-page PDF embedding ``ref``/``title`` as page text. Byte offsets are computed at
    build time; no /Info, /CreationDate, or /ID (the only time-derived fields), so it is fully deterministic."""
    content = b"BT /F1 18 Tf 72 720 Td (" + f"{title} {ref}".encode("latin-1") + b") Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_pos = len(out)
    count = len(objs) + 1
    out += b"xref\n0 %d\n" % count
    out += b"0000000000 65535 f \n"  # free-list head (20 bytes incl. the trailing space + \n)
    for off in offsets:
        out += b"%010d 00000 n \n" % off  # each entry exactly 20 bytes
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (count, xref_pos)
    return bytes(out)
