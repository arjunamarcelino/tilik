"""Load the Prompt 04 synthetic bundle (``data/synthetic/out``) into in-memory ``Episode`` objects so the
pure detector tests run against the real planted ground truth — without a database.

The generator's surrogate refs (``ep_``/``cv_``/``ev_``) are used directly as ids (they are never imported
into the DB; the import pipeline maps them to cuids). ``manifest.json`` labels (``expectFinding`` /
``clusterId`` / ``relatedRefs``) key on the same refs, so a test correlates a built ``Episode`` to its
ground-truth label by ref. The bundle is gitignored, so ``require_bundle()`` skips the suite with a clear
regenerate hint when it is absent (same convention as the DB tests).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from detector.models import (
    ClaimLineView,
    ClaimVersionView,
    CloneDoc,
    Episode,
    EvidenceLinkView,
    EvidenceView,
)

_OUT = Path(__file__).resolve().parents[3] / "data" / "synthetic" / "out"


def require_bundle() -> None:
    """Skip the calling test if the synthetic bundle has not been generated."""
    if not (_OUT / "manifest.json").is_file():
        pytest.skip(
            "synthetic bundle missing — run the Prompt 04 generator (data/synthetic → out/) to run "
            "these detector precision/recall tests"
        )


def _dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _read(name: str) -> Any:
    return json.loads((_OUT / name).read_text(encoding="utf-8"))


def load_episodes() -> dict[str, Episode]:
    """Build ``Episode`` objects keyed by episode ref, with all claims (+lines), evidence, and links."""
    episodes = _read("episodes.json")
    claim_versions = _read("claim-versions.json")
    evidence_records = _read("evidence-records.json")
    evidence_links = _read("evidence-links.json")

    # is_current: the highest version per claimNo is current (the bundle omits the field — it's set at import).
    max_version: dict[str, int] = {}
    for cv in claim_versions:
        max_version[cv["claimNo"]] = max(max_version.get(cv["claimNo"], 0), cv["version"])

    claims_by_episode: dict[str, list[ClaimVersionView]] = {}
    for cv in claim_versions:
        lines = [
            ClaimLineView(
                type=ln["type"],
                code=ln["code"],
                sequence=ln["sequence"],
                description=ln.get("description"),
                amount=None if ln.get("amount") is None else Decimal(str(ln["amount"])),
            )
            for ln in cv.get("lines", [])
        ]
        claims_by_episode.setdefault(cv["episodeRef"], []).append(
            ClaimVersionView(
                id=cv["ref"],
                version=cv["version"],
                claim_no=cv["claimNo"],
                inacbg_code=cv["inacbgCode"],
                amount=Decimal(str(cv["amount"])),
                content_hash="",  # computed at import; detectors don't use it
                fingerprint=None,
                status=cv["status"],
                is_current=cv["version"] == max_version[cv["claimNo"]],
                submitted_at=_dt(cv["submittedAt"]),
                lines=lines,
            )
        )

    evidence_by_episode: dict[str, list[EvidenceView]] = {}
    for ev in evidence_records:
        evidence_by_episode.setdefault(ev["episodeRef"], []).append(
            EvidenceView(
                id=ev["ref"],
                kind=ev["kind"],
                object_key=ev["file"] if isinstance(ev.get("file"), str) else None,
                payload=ev.get("payload"),
                content_hash="",
                fingerprint=None,
                captured_at=_dt(ev["capturedAt"]),
            )
        )

    # Links carry refs (cv_/ev_); map them onto the ids we used (same refs) and group by the evidence's episode.
    episode_of_evidence = {ev["ref"]: ev["episodeRef"] for ev in evidence_records}
    links_by_episode: dict[str, list[EvidenceLinkView]] = {}
    for el in evidence_links:
        episode_ref = episode_of_evidence.get(el["evidenceRef"])
        if episode_ref is None:
            continue
        links_by_episode.setdefault(episode_ref, []).append(
            EvidenceLinkView(
                evidence_id=el["evidenceRef"],
                claim_version_id=el.get("claimVersionRef"),
                relation=el["relation"],
                note=el.get("note"),
            )
        )

    built: dict[str, Episode] = {}
    for ep in episodes:
        ref = ep["ref"]
        built[ref] = Episode(
            id=ref,
            patient_token=f"patient:{ep['patientRef']}",  # a stable per-patient token stand-in for tests
            facility_id=ep["facilityId"],
            started_at=_dt(ep["startedAt"]),
            ended_at=_dt(ep.get("endedAt")),
            import_batch_id=None,
            claims=claims_by_episode.get(ref, []),
            evidence=evidence_by_episode.get(ref, []),
            links=links_by_episode.get(ref, []),
        )
    return built


def load_labels() -> dict[str, dict[str, Any]]:
    """The manifest's per-episode ground-truth labels (expectFinding / detector / clusterId / relatedRefs)."""
    return _read("manifest.json")["labels"]


def clone_corpus(episodes: dict[str, Episode], exclude_ref: str) -> list[CloneDoc]:
    """Every OTHER episode's medical-record narrative as the cloning corpus — mirrors
    ``repository.load_clone_corpus`` (whole-DB, excludes the current episode by id, ordered by evidence id)."""
    docs: list[CloneDoc] = []
    for ref, episode in episodes.items():
        if ref == exclude_ref:
            continue
        for ev in episode.evidence:
            if ev.kind == "MEDICAL_RECORD" and ev.payload and isinstance(ev.payload.get("narrative"), str):
                docs.append(CloneDoc(evidence_id=ev.id, episode_id=ref, narrative=ev.payload["narrative"]))
    return sorted(docs, key=lambda d: d.evidence_id)
