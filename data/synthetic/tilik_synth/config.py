"""Static configuration: enum mirrors, clinical vocabulary, and the category mix.

Determinism note: nothing here derives from wall-clock time or process state. ``BASE_DATE`` is a fixed
constant; every emitted timestamp is ``BASE_DATE`` + a deterministic integer offset.

Enum string values mirror ``packages/shared/src/enums.ts`` (the single source of truth). There is no Python
parity guard — keep this block in sync by hand when the shared enums change.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

# Fixed epoch for all timestamps (tz-aware UTC). Never use datetime.now()/date.today().
BASE_DATE = datetime(2026, 1, 1, tzinfo=timezone.utc)

BUNDLE_SCHEMA_VERSION = "1"
GENERATOR_NAME = "tilik-synthetic"
GENERATOR_VERSION = "0.1.0"

# --- Enum mirrors (packages/shared/src/enums.ts) -------------------------------------------------

# EvidenceKind
MEDICAL_RECORD = "MEDICAL_RECORD"
LAB = "LAB"
IMAGING = "IMAGING"
ATTACHMENT = "ATTACHMENT"
# (CLAIM is intentionally never emitted — the import endpoint derives it from each ClaimVersion.)

# ClaimLineType
DIAGNOSIS = "DIAGNOSIS"
PROCEDURE = "PROCEDURE"

# ClaimStatus
ACTIVE = "ACTIVE"

# DetectorType (used only as ground-truth labels in the manifest)
REPEAT_BILLING = "REPEAT_BILLING"
CLONING = "CLONING"
PERTENTANGAN_BUKTI = "PERTENTANGAN_BUKTI"

# EvidenceLink.relation — CHECK ('mendukung','bertentangan','sumber') in the init migration.
REL_SUPPORT = "mendukung"
REL_CONTRADICT = "bertentangan"
REL_SOURCE = "sumber"

# --- Clinical vocabulary (public codes — not PII) ------------------------------------------------


@dataclass(frozen=True)
class Procedure:
    """An ICD-9-CM procedure with its required supporting docs and tariff band.

    ``requires`` lists the evidence a legitimate claim for this procedure must carry (consumed by the
    scenario builders). ``tariff`` is (min, max) in whole rupiah; amounts are drawn as integers (never
    floats) and capped well under 12 digits so they can never trip the no-PII digit scan. Repeatability is
    expressed by membership in REPEATABLE_PROCEDURES vs SURGICAL_PROCEDURES below.
    """

    code: str
    label: str
    requires: tuple[str, ...]
    tariff: tuple[int, int]


# Legitimately repeatable (same patient/day is NOT fraud); no mandatory supporting docs.
HEMODIALYSIS = Procedure("39.95", "Hemodialisis", (), (900_000, 1_100_000))
CHEMOTHERAPY = Procedure("99.25", "Kemoterapi (injeksi/infus)", (), (150_000, 3_000_000))
# One-time (billed twice same patient/day is a strong fraud signal); require operative + anaesthesia docs.
APPENDECTOMY = Procedure("47.09", "Apendektomi", ("laporan operasi", "laporan anestesi"), (5_000_000, 12_000_000))
CHOLECYSTECTOMY = Procedure("51.23", "Kolesistektomi laparoskopi", ("laporan operasi", "laporan anestesi"), (10_000_000, 20_000_000))

REPEATABLE_PROCEDURES = (HEMODIALYSIS, CHEMOTHERAPY)
SURGICAL_PROCEDURES = (APPENDECTOMY, CHOLECYSTECTOMY)

# ICD-10 diagnoses (code, description) keyed loosely to the procedures above.
DIAGNOSES = (
    ("N18.5", "Penyakit ginjal kronik stadium 5"),
    ("E11.9", "Diabetes melitus tipe 2 tanpa komplikasi"),
    ("I10", "Hipertensi esensial (primer)"),
    ("K35.80", "Apendisitis akut"),
    ("K80.20", "Kolelitiasis tanpa kolesistitis"),
    ("J18.9", "Pneumonia, organisme tidak dispesifikasi"),
    ("C50.9", "Neoplasma ganas payudara"),
    ("Z51.1", "Sesi kemoterapi untuk neoplasma"),
)

# INA-CBG code pieces — format X-N-NN-S (CMG letter, case-group digit, 2-digit case-type, severity).
INACBG_CMG = ("A", "B", "C", "G", "K", "L", "M", "N", "O")
INACBG_SEVERITY = ("I", "II", "III", "0")

# Evidence provenance strings (all obviously synthetic).
SOURCE_EMR = "SYN-EMR"
SOURCE_LAB = "SYN-LIS"
SOURCE_PACS = "SYN-PACS"
INGESTED_BY = "SYN-UPLOADER-01"

# --- Category mix --------------------------------------------------------------------------------

# Categories whose episodes carry ground-truth labels.
CLEAN = "clean"
FRAUD_REPEAT_BILLING = "fraud_repeat_billing"
FRAUD_CLONING = "fraud_cloning"
FRAUD_CONTRADICTION = "fraud_contradiction"
EXCEPTION_REPEATABLE = "exception_repeatable_procedure"
EXCEPTION_SOAP = "exception_soap_template"

# Each planted family gets round(episodes * SEED_RATIO) episodes; clean takes the remainder.
SEED_RATIO = 0.07
# Minimum episodes required to fit all five families (each at its floor) plus a clean majority.
MIN_EPISODES = 25
