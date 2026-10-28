"""Bundle accumulator: collects entities + ground-truth labels, then serializes, guards, and writes.

The guard (no-PII scan + referential/integrity asserts) runs over the exact in-memory structures and file
bytes **before anything is written**, so a failing run never materializes real-looking PII on disk.
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import config

# --- Guard patterns ------------------------------------------------------------------------------

# 12+ digits allowing a single separator between each — catches grouped NIK/NPWP/BPJS/phone
# (e.g. "3173 0522 0890 0001", "09.254.294.3-407.000"). Unanchored so embedded runs also hit.
# Used on JSON/narrative text, where free-form human identifiers would appear.
_DIGIT_RUN = re.compile(r"\d(?:[ .\-]?\d){11,}")
# Contiguous 12+ digits only — used on binary file bytes, whose structure legitimately contains
# space-separated digit groups (e.g. a PDF xref table's zero-padded offsets). Our generated files only
# embed the (validated) evidence ref + a fixed title, so a grouped identifier can't originate there.
_DIGIT_RUN_CONTIG = re.compile(r"\d{12,}")
_AMOUNT = re.compile(r"^\d{1,12}\.\d{2}$")
_PATIENT_REF = re.compile(r"^SYN-PATIENT-\d{4,}$")
_FACILITY_ID = re.compile(r"^SYN-FAC-\d+$")
_RELATIONS = frozenset({config.REL_SUPPORT, config.REL_CONTRADICT, config.REL_SOURCE})


class GuardError(Exception):
    """Raised when the bundle would leak a real-looking identifier or violate an invariant."""


# --- Entities (frozen; serialized via asdict) ----------------------------------------------------


@dataclass(frozen=True)
class ClaimLine:
    type: str
    code: str
    sequence: int
    description: str | None
    amount: str | None


@dataclass(frozen=True)
class Episode:
    ref: str
    patientRef: str
    facilityId: str
    startedAt: str
    endedAt: str | None


@dataclass(frozen=True)
class ClaimVersion:
    ref: str
    episodeRef: str
    claimNo: str
    version: int
    inacbgCode: str
    amount: str
    status: str
    submittedAt: str
    lines: list[ClaimLine]


@dataclass(frozen=True)
class EvidenceRecord:
    ref: str
    episodeRef: str
    kind: str
    payload: dict | None
    file: str | None
    capturedAt: str
    source: str
    ingestedBy: str | None


@dataclass(frozen=True)
class EvidenceLink:
    ref: str
    evidenceRef: str
    claimVersionRef: str | None
    relation: str
    note: str | None


@dataclass
class Bundle:
    seed: int
    seed_fraud: bool
    requested_episodes: int
    episodes: list[Episode] = field(default_factory=list)
    claims: list[ClaimVersion] = field(default_factory=list)
    evidence: list[EvidenceRecord] = field(default_factory=list)
    links: list[EvidenceLink] = field(default_factory=list)
    labels: dict[str, dict] = field(default_factory=dict)
    _files: dict[str, bytes] = field(default_factory=dict)

    # --- accumulation --------------------------------------------------------

    def add_episode(self, ep: Episode, *, label: dict) -> str:
        """Add an episode; a ground-truth ``label`` is REQUIRED (keeps labels complete by construction)."""
        self.episodes.append(ep)
        self.labels[ep.ref] = label
        return ep.ref

    def add_claim(self, claim: ClaimVersion) -> str:
        self.claims.append(claim)
        return claim.ref

    def add_evidence(self, ev: EvidenceRecord, *, file_bytes: bytes | None = None) -> str:
        if file_bytes is not None:
            self._files[ev.ref] = file_bytes
        self.evidence.append(ev)
        return ev.ref

    def add_link(self, link: EvidenceLink) -> str:
        self.links.append(link)
        return link.ref

    # --- serialization -------------------------------------------------------

    def _serialized(self) -> dict[str, object]:
        """Build the JSON-ready structures (arrays sorted by ref, lines by (type, sequence))."""

        def claim_dict(c: ClaimVersion) -> dict:
            d = asdict(c)
            d["lines"] = [asdict(ln) for ln in sorted(c.lines, key=lambda ln: (ln.type, ln.sequence))]
            return d

        return {
            "episodes.json": [asdict(e) for e in sorted(self.episodes, key=lambda e: e.ref)],
            "claim-versions.json": [claim_dict(c) for c in sorted(self.claims, key=lambda c: c.ref)],
            "evidence-records.json": [asdict(e) for e in sorted(self.evidence, key=lambda e: e.ref)],
            "evidence-links.json": [asdict(ln) for ln in sorted(self.links, key=lambda ln: ln.ref)],
        }

    def _manifest(self) -> dict:
        by_category: dict[str, int] = {}
        for lab in self.labels.values():
            by_category[lab["category"]] = by_category.get(lab["category"], 0) + 1
        return {
            # Top-level so a consumer (Prompt 06) can version-gate its parser without reaching into
            # provenance metadata. Bump when the bundle's shape changes.
            "bundleSchemaVersion": config.BUNDLE_SCHEMA_VERSION,
            "generator": {
                "name": config.GENERATOR_NAME,
                "generatorVersion": config.GENERATOR_VERSION,
                "seed": self.seed,
                "seedFraud": self.seed_fraud,
                "requestedEpisodes": self.requested_episodes,
                "faker": {"locale": "id_ID", "version": "40.43.0"},
                "python": ">=3.11 (checksums.txt pinned to the generating toolchain)",
            },
            "loadOrder": [
                "episodes.json",
                "claim-versions.json",
                "evidence-records.json",
                "evidence-links.json",
            ],
            "counts": {
                "episodes": len(self.episodes),
                "claimVersions": len(self.claims),
                "evidenceRecords": len(self.evidence),
                "evidenceLinks": len(self.links),
                "files": len(self._files),
                "byCategory": dict(sorted(by_category.items())),
            },
            "labels": dict(sorted(self.labels.items())),
        }

    # --- guard + integrity ---------------------------------------------------

    def _guard(self, files: dict[str, object], manifest: dict) -> None:
        for name, payload in files.items():
            _scan(payload, name)
        _scan(manifest, "manifest.json")
        for ref, data in self._files.items():
            _scan_bytes(data, f"files/{ref}")

    def _check_integrity(self, files: dict[str, object]) -> None:
        ep_refs = {e.ref for e in self.episodes}
        cv_refs = {c.ref for c in self.claims}
        ev_refs = {e.ref for e in self.evidence}

        for e in self.episodes:
            _require(_PATIENT_REF.match(e.patientRef), f"bad patientRef {e.patientRef!r}")
            _require(_FACILITY_ID.match(e.facilityId), f"bad facilityId {e.facilityId!r}")
            _require(e.ref in self.labels, f"episode {e.ref} missing a manifest label")

        for c in self.claims:
            _require(c.episodeRef in ep_refs, f"claim {c.ref} -> unknown episode {c.episodeRef}")
            _require(c.version == 1, f"claim {c.ref} version must be 1")
            _check_amount(c.amount, f"claim {c.ref}")
            for ln in c.lines:
                if ln.amount is not None:
                    _check_amount(ln.amount, f"claim {c.ref} line {ln.code}")

        for e in self.evidence:
            _require(e.episodeRef in ep_refs, f"evidence {e.ref} -> unknown episode {e.episodeRef}")
            has_payload = e.payload is not None
            has_file = e.file is not None
            _require(has_payload != has_file, f"evidence {e.ref} must have exactly one of payload/file")
            if has_file:
                _require(e.ref in self._files, f"evidence {e.ref} file bytes missing")
                _require(e.file == f"files/{e.ref}.png" or e.file.startswith("files/"), f"bad file path {e.file}")
            _require(e.source.startswith("SYN"), f"evidence {e.ref} non-synthetic source {e.source!r}")

        for ln in self.links:
            _require(ln.evidenceRef in ev_refs, f"link {ln.ref} -> unknown evidence {ln.evidenceRef}")
            _require(
                ln.claimVersionRef is None or ln.claimVersionRef in cv_refs,
                f"link {ln.ref} -> unknown claim {ln.claimVersionRef}",
            )
            _require(ln.relation in _RELATIONS, f"link {ln.ref} bad relation {ln.relation!r}")

    # --- write ---------------------------------------------------------------

    def write(self, out_dir: Path) -> dict:
        files = self._serialized()
        manifest = self._manifest()
        # Guard + integrity BEFORE any disk write.
        self._guard(files, manifest)
        self._check_integrity(files)

        _safe_wipe(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "files").mkdir(exist_ok=True)

        for name, payload in files.items():
            _write_json(out_dir / name, payload)
        _write_json(out_dir / "manifest.json", manifest)
        for ref, data in sorted(self._files.items()):
            ext = "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "pdf"
            (out_dir / "files" / f"{ref}.{ext}").write_bytes(data)

        return manifest["counts"]


# --- module-level helpers ------------------------------------------------------------------------


def _require(condition: object, message: str) -> None:
    if not condition:
        raise GuardError(message)


def _check_amount(value: str, where: str) -> None:
    _require(_AMOUNT.match(value), f"{where}: amount {value!r} must match ^\\d{{1,12}}\\.\\d{{2}}$")


def _scan_text(text: str, where: str) -> None:
    m = _DIGIT_RUN.search(text)
    if m:
        raise GuardError(f"possible real identifier {m.group()!r} at {where}")


def _scan(obj: object, where: str) -> None:
    """Recursively scan a JSON-ish structure; skip the (numeric, validated) 'amount' field values."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            _scan_text(str(k), f"{where}.{k} (key)")
            if k == "amount" and isinstance(v, (str, type(None))):
                continue
            _scan(v, f"{where}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _scan(v, f"{where}[{i}]")
    elif isinstance(obj, str):
        _scan_text(obj, where)
    elif isinstance(obj, bool) or obj is None:
        return  # booleans / null carry no digits (bool before int: bool is an int subclass)
    elif isinstance(obj, (int, float)):
        # Integers serialize to raw digits on disk (e.g. an identifier-shaped --seed in manifest.generator),
        # so scan their string form too — the early-return here was the int-bypass hole.
        _scan_text(str(obj), where)
    else:  # fail-closed on anything the walker doesn't recognize
        raise GuardError(f"unscannable type {type(obj).__name__} at {where}")


def _scan_bytes(data: bytes, where: str) -> None:
    text = data.decode("latin-1", errors="replace")
    m = _DIGIT_RUN_CONTIG.search(text)
    if m:
        raise GuardError(f"possible real identifier {m.group()!r} in file bytes at {where}")


def _write_json(path: Path, payload: object) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def _safe_wipe(out_dir: Path) -> None:
    out = out_dir.resolve()
    if out == Path.cwd().resolve() or out == Path.home().resolve() or out.parent == out:
        raise GuardError(f"refusing to wipe {out}")
    if out.exists():
        manifest = out / "manifest.json"
        looks_like_bundle = not any(out.iterdir()) or (
            manifest.exists() and config.GENERATOR_NAME in manifest.read_text(encoding="utf-8")
        )
        if not looks_like_bundle:
            raise GuardError(f"{out} is neither empty nor a prior {config.GENERATOR_NAME} bundle; refusing to wipe")
        shutil.rmtree(out)
