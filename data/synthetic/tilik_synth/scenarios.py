"""Scenario builders — one per episode category. Each takes ``(bundle, gen)`` and appends labeled episodes.

The five seeded families plant the patterns the detectors must catch (fraud) or tolerate (exception); the
manifest label on every episode records ``expectFinding`` so a later harness can score precision/recall.
"""

from __future__ import annotations

from . import config
from .bundle import Bundle, ClaimLine, ClaimVersion, Episode, EvidenceLink, EvidenceRecord
from .gen import Gen, pdf_bytes, png_bytes
from .narratives import clone_narrative, soap_template_narrative

FACILITIES = tuple(f"SYN-FAC-{i:02d}" for i in range(1, 9))


# --- shared helpers ------------------------------------------------------------------------------


def _num(ref: str) -> str:
    return ref.split("_", 1)[1]


def _new_episode(
    bundle: Bundle, gen: Gen, *, label: dict, patient_ref: str | None = None, day: int | None = None
) -> tuple[str, str, int]:
    ep_ref = gen.next_ref("ep")
    if patient_ref is None:
        patient_ref = f"SYN-PATIENT-{_num(gen.next_ref('pat'))}"
    if day is None:
        day = gen.rng.randint(0, 300)
    ep = Episode(
        ref=ep_ref,
        patientRef=patient_ref,
        facilityId=gen.pick(FACILITIES),
        startedAt=gen.timestamp(day_offset=day, hour=gen.rng.randint(7, 10)),
        endedAt=gen.timestamp(day_offset=day, hour=gen.rng.randint(13, 18)),
    )
    bundle.add_episode(ep, label=label)
    return ep_ref, patient_ref, day


def _claim(
    bundle: Bundle, gen: Gen, ep_ref: str, *, lines: list[ClaimLine], amount: str, day: int, inacbg: str | None = None
) -> str:
    cv_ref = gen.next_ref("cv")
    bundle.add_claim(
        ClaimVersion(
            ref=cv_ref,
            episodeRef=ep_ref,
            claimNo=f"SYN-CLM-{_num(cv_ref)}",
            version=1,
            inacbgCode=inacbg or gen.inacbg(),
            amount=amount,
            status=config.ACTIVE,
            submittedAt=gen.timestamp(day_offset=day, hour=10),
            lines=lines,
        )
    )
    return cv_ref


def _dx_line(gen: Gen) -> ClaimLine:
    code, desc = gen.pick(config.DIAGNOSES)
    return ClaimLine(type=config.DIAGNOSIS, code=code, sequence=1, description=desc, amount=None)


def _proc_line(proc: config.Procedure, amount: str) -> ClaimLine:
    return ClaimLine(type=config.PROCEDURE, code=proc.code, sequence=1, description=proc.label, amount=amount)


def _inline_evidence(bundle: Bundle, gen: Gen, ep_ref: str, kind: str, payload: dict, *, day: int, source: str) -> str:
    ev_ref = gen.next_ref("ev")
    bundle.add_evidence(
        EvidenceRecord(
            ref=ev_ref,
            episodeRef=ep_ref,
            kind=kind,
            payload=payload,
            file=None,
            capturedAt=gen.timestamp(day_offset=day, hour=9),
            source=source,
            ingestedBy=config.INGESTED_BY,
        )
    )
    return ev_ref


def _file_evidence(
    bundle: Bundle, gen: Gen, ep_ref: str, kind: str, *, day: int, source: str, title: str, as_pdf: bool = False
) -> str:
    ev_ref = gen.next_ref("ev")
    data = pdf_bytes(ev_ref, title) if as_pdf else png_bytes(ev_ref)
    ext = "pdf" if as_pdf else "png"
    bundle.add_evidence(
        EvidenceRecord(
            ref=ev_ref,
            episodeRef=ep_ref,
            kind=kind,
            payload=None,
            file=f"files/{ev_ref}.{ext}",
            capturedAt=gen.timestamp(day_offset=day, hour=9),
            source=source,
            ingestedBy=config.INGESTED_BY,
        ),
        file_bytes=data,
    )
    return ev_ref


def _link(bundle: Bundle, gen: Gen, ev_ref: str, cv_ref: str | None, relation: str, note: str | None = None) -> None:
    bundle.add_link(
        EvidenceLink(ref=gen.next_ref("el"), evidenceRef=ev_ref, claimVersionRef=cv_ref, relation=relation, note=note)
    )


def _soap_payload(gen: Gen, name: str, mrn: str, variant: int | None = None) -> dict:
    return {"format": "soap", "docType": "resume medis", "narrative": soap_template_narrative(gen, name, mrn, variant)}


# --- category builders ---------------------------------------------------------------------------


def build_clean(bundle: Bundle, gen: Gen) -> None:
    """A clean episode. ~1/4 are surgical (carrying the required operative + anaesthesia docs) to contrast
    with the contradiction scenario; the rest are medical outpatient cases with a SOAP record."""
    label = {"category": config.CLEAN, "expectFinding": False}
    ep_ref, patient, day = _new_episode(bundle, gen, label=label)
    name = gen.faker.name()
    mrn = f"SYN-RM-{_num(ep_ref)}"

    if gen.rng.randint(0, 3) == 0:  # surgical clean case
        proc = gen.pick(config.SURGICAL_PROCEDURES)
        amount = gen.money(*proc.tariff)
        cv = _claim(bundle, gen, ep_ref, lines=[_dx_line(gen), _proc_line(proc, amount)], amount=amount, day=day)
        # Carry every supporting doc the procedure requires (drives off proc.requires so fixture and rule
        # can't drift) — this is exactly what build_contradiction omits.
        for doc in proc.requires:
            ev = _file_evidence(bundle, gen, ep_ref, config.ATTACHMENT, day=day, source=config.SOURCE_EMR,
                                title=doc.title(), as_pdf=True)
            _link(bundle, gen, ev, cv, config.REL_SUPPORT, f"{doc} mendukung tindakan")
    else:  # medical outpatient case
        amount = gen.money(150_000, 400_000)
        cv = _claim(bundle, gen, ep_ref, lines=[_dx_line(gen)], amount=amount, day=day)
        rec = _inline_evidence(bundle, gen, ep_ref, config.MEDICAL_RECORD, _soap_payload(gen, name, mrn),
                               day=day, source=config.SOURCE_EMR)
        lab = _file_evidence(bundle, gen, ep_ref, config.LAB, day=day, source=config.SOURCE_LAB, title="Hasil Lab")
        _link(bundle, gen, rec, cv, config.REL_SOURCE, "catatan medis sumber klaim")
        _link(bundle, gen, lab, cv, config.REL_SUPPORT, "hasil lab mendukung diagnosis")


def build_repeat_billing(bundle: Bundle, gen: Gen) -> None:
    """Same patient + same day, two claims billing the SAME non-repeatable procedure → should be flagged."""
    proc = gen.pick(config.SURGICAL_PROCEDURES)
    label = {
        "category": config.FRAUD_REPEAT_BILLING,
        "detector": config.REPEAT_BILLING,
        "expectFinding": True,
        "note": f"{proc.label} ({proc.code}) dibilling 2x, pasien+hari sama",
    }
    ep_ref, patient, day = _new_episode(bundle, gen, label=label)
    related = []
    for _ in range(2):
        amount = gen.money(*proc.tariff)
        related.append(_claim(bundle, gen, ep_ref, lines=[_dx_line(gen), _proc_line(proc, amount)], amount=amount, day=day))
    bundle.labels[ep_ref]["relatedRefs"] = related


def build_cloning(bundle: Bundle, gen: Gen, k: int, cluster_id: str) -> None:
    """k episodes, different patients, byte-identical clinical narrative (only name/MRN swapped) → flagged."""
    for _ in range(k):
        label = {"category": config.FRAUD_CLONING, "detector": config.CLONING, "expectFinding": True, "clusterId": cluster_id}
        ep_ref, patient, day = _new_episode(bundle, gen, label=label)
        name = gen.faker.name()
        mrn = f"SYN-RM-{_num(ep_ref)}"
        amount = gen.money(5_000_000, 12_000_000)
        cv = _claim(bundle, gen, ep_ref, lines=[_dx_line(gen), _proc_line(config.APPENDECTOMY, amount)], amount=amount, day=day)
        payload = {"format": "soap", "docType": "resume medis", "narrative": clone_narrative(name, mrn)}
        rec = _inline_evidence(bundle, gen, ep_ref, config.MEDICAL_RECORD, payload, day=day, source=config.SOURCE_EMR)
        _link(bundle, gen, rec, cv, config.REL_SOURCE, "catatan medis sumber klaim")


def build_contradiction(bundle: Bundle, gen: Gen) -> None:
    """A surgical claim whose required operative + anaesthesia evidence is absent → flagged."""
    proc = gen.pick(config.SURGICAL_PROCEDURES)
    label = {
        "category": config.FRAUD_CONTRADICTION,
        "detector": config.PERTENTANGAN_BUKTI,
        "expectFinding": True,
        "note": f"klaim {proc.label} tanpa {' / '.join(proc.requires)}",
    }
    ep_ref, patient, day = _new_episode(bundle, gen, label=label)
    name = gen.faker.name()
    mrn = f"SYN-RM-{_num(ep_ref)}"
    amount = gen.money(*proc.tariff)
    cv = _claim(bundle, gen, ep_ref, lines=[_dx_line(gen), _proc_line(proc, amount)], amount=amount, day=day)
    # Only an unrelated discharge summary — the mandatory laporan operasi + laporan anestesi are omitted.
    payload = {"format": "soap", "docType": "resume medis", "narrative": _soap_payload(gen, name, mrn)["narrative"]}
    rec = _inline_evidence(bundle, gen, ep_ref, config.MEDICAL_RECORD, payload, day=day, source=config.SOURCE_EMR)
    _link(bundle, gen, rec, cv, config.REL_SOURCE, "resume medis; bukti tindakan bedah tidak ditemukan")


def build_exception_repeatable(bundle: Bundle, gen: Gen) -> None:
    """Same patient, a LEGITIMATELY repeatable procedure (dialysis/chemo) repeated across days → NOT flagged."""
    proc = gen.pick(config.REPEATABLE_PROCEDURES)
    label = {
        "category": config.EXCEPTION_REPEATABLE,
        "detector": config.REPEAT_BILLING,
        "expectFinding": False,
        "note": f"{proc.label} ({proc.code}) sah diulang sesuai jadwal",
    }
    ep_ref, patient, day = _new_episode(bundle, gen, label=label)
    related = []
    for session in range(3):  # recurring schedule, different days
        sday = day + session * 3
        amount = gen.money(*proc.tariff)
        related.append(_claim(bundle, gen, ep_ref, lines=[_dx_line(gen), _proc_line(proc, amount)], amount=amount, day=sday))
    bundle.labels[ep_ref]["relatedRefs"] = related


def build_exception_soap(bundle: Bundle, gen: Gen, k: int, cluster_id: str) -> None:
    """k episodes sharing the SOAP scaffold but with genuinely different clinical content → NOT flagged.

    Each episode gets a DISTINCT complaint/vitals (by index), so shared tokens are only the boilerplate
    scaffold — pairwise similarity stays at the boilerplate floor, clearly below the cloning cluster."""
    for i in range(k):
        label = {"category": config.EXCEPTION_SOAP, "detector": config.CLONING, "expectFinding": False, "clusterId": cluster_id}
        ep_ref, patient, day = _new_episode(bundle, gen, label=label)
        name = gen.faker.name()
        mrn = f"SYN-RM-{_num(ep_ref)}"
        amount = gen.money(150_000, 400_000)
        cv = _claim(bundle, gen, ep_ref, lines=[_dx_line(gen)], amount=amount, day=day)
        rec = _inline_evidence(bundle, gen, ep_ref, config.MEDICAL_RECORD, _soap_payload(gen, name, mrn, variant=i),
                               day=day, source=config.SOURCE_EMR)
        _link(bundle, gen, rec, cv, config.REL_SOURCE, "formulir SOAP standar")
