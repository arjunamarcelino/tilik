"""Clinical narrative builders for the two CLONING clusters.

The detector must key on *content*, not *structure*. These two builders are constructed so the clusters
land on opposite sides of any reasonable near-duplicate threshold:

* ``clone_narrative`` — one fixed ~200-word clinical story; clones swap only identity tokens (name, MRN),
  so full-text similarity stays ~0.95+ (copy-paste fraud that must be flagged).
* ``soap_template_narrative`` — a shared SOAP scaffold + stock boilerplate (< 30% of tokens) wrapped around
  genuinely different clinical content (≥ 100 content words), so content similarity stays low (legitimate
  standardized forms that must NOT be flagged).

Every narrative carries a visible "nama fiktif / data sintetis" disclaimer; no real quasi-identifiers
(addresses, postcodes, birthdates, phone numbers) ever appear beside a name.
"""

from __future__ import annotations

from .gen import Gen

# CONSUMED CONTRACT: every narrative's first two lines are the disclaimer and a "Nama: … | No. RM: …"
# identity line. services/detector's cloning.strip_boilerplate strips exactly those before TF-IDF, keying on
# the prefixes pinned in test-vectors/narrative-format.json (asserted from both sides). Changing these line
# prefixes silently degrades the CLONING detector — update the vector and both tests if you do.
_DISCLAIMER = "[Data sintetis — nama fiktif, bukan pasien nyata.]"

# A single, fixed clinical story. Clones substitute only {name}/{mrn}; all clinical sentences are identical.
_CLONE_TEMPLATE = (
    "{disclaimer}\n"
    "Nama: {name} | No. RM: {mrn}\n"
    "S: Pasien datang dengan keluhan nyeri perut kanan bawah sejak dua hari yang lalu, "
    "disertai mual, muntah satu kali, dan demam ringan. Nafsu makan menurun. Nyeri bertambah "
    "saat bergerak dan batuk. Tidak ada riwayat trauma maupun operasi sebelumnya.\n"
    "O: Keadaan umum tampak sakit sedang, kesadaran composmentis. Tekanan darah 120/80 mmHg, "
    "nadi 96x/menit, suhu 38,1 derajat Celsius, laju napas 20x/menit. Abdomen: nyeri tekan "
    "dan nyeri lepas pada titik McBurney, defans muskuler positif. Pemeriksaan laboratorium "
    "menunjukkan leukositosis dengan dominasi neutrofil.\n"
    "A: Apendisitis akut dengan tanda iritasi peritoneum lokal.\n"
    "P: Direncanakan apendektomi cito. Pasien dipuasakan, dipasang jalur intravena, diberikan "
    "analgetik dan antibiotik profilaksis. Konsultasi anestesi untuk kesiapan operasi. Edukasi "
    "mengenai prosedur dan risiko telah diberikan kepada pasien dan keluarga."
)

# --- SOAP-template pieces (shared scaffold, varied content) --------------------------------------

_COMPLAINTS = (
    ("batuk berdahak sejak lima hari disertai sesak napas ringan", "J18.9", "Pneumonia komunitas",
     "amoksisilin 500 mg tiga kali sehari dan parasetamol bila demam"),
    ("sering haus, banyak kencing, dan berat badan menurun dalam sebulan terakhir", "E11.9",
     "Diabetes melitus tipe 2", "metformin 500 mg dua kali sehari dan edukasi diet rendah gula"),
    ("nyeri kepala berdenyut dan tengkuk terasa berat sejak pagi", "I10", "Hipertensi esensial",
     "amlodipin 5 mg sekali sehari dan pembatasan garam"),
    ("lemas, pucat, dan mudah lelah sejak dua minggu", "N18.5", "Penyakit ginjal kronik",
     "suplementasi besi dan rujukan untuk evaluasi dialisis"),
)

_VITALS = (
    ("118/76", 84, "36,7"),
    ("134/88", 92, "37,2"),
    ("150/95", 100, "36,9"),
    ("126/82", 78, "38,0"),
)


def clone_narrative(name: str, mrn: str) -> str:
    return _CLONE_TEMPLATE.format(disclaimer=_DISCLAIMER, name=name, mrn=mrn)


def soap_template_narrative(gen: Gen, name: str, mrn: str, variant: int | None = None) -> str:
    """Shared SOAP scaffold around patient-specific content.

    When ``variant`` is given, the complaint/vitals are selected deterministically by index so episodes in
    one exception cluster carry *distinct* clinical content (keeping their pairwise similarity at the
    boilerplate floor, well below the cloning cluster). When ``None``, content is drawn at random (used for
    clean/contradiction records, which only need corpus-representative SOAP text)."""
    if variant is None:
        complaint, icd, assessment, plan = gen.pick(_COMPLAINTS)
        bp, pulse, temp = gen.pick(_VITALS)
    else:
        complaint, icd, assessment, plan = _COMPLAINTS[variant % len(_COMPLAINTS)]
        bp, pulse, temp = _VITALS[variant % len(_VITALS)]
    age = gen.rng.randint(25, 70)
    # Boilerplate: the four SOAP labels + stock "keadaan umum/kesadaran" + the standard education line.
    # Discriminative: complaint, vitals, assessment/ICD, therapy — the majority of the tokens.
    return (
        f"{_DISCLAIMER}\n"
        f"Nama: {name} | No. RM: {mrn} | Usia: {age} tahun\n"
        f"S: Pasien mengeluh {complaint}. Keluhan dirasakan mengganggu aktivitas sehari-hari dan "
        f"menjadi alasan utama kunjungan ke poliklinik pada hari ini.\n"
        f"O: Keadaan umum baik, kesadaran composmentis. Tekanan darah {bp} mmHg, nadi {pulse}x/menit, "
        f"suhu {temp} derajat Celsius. Pemeriksaan fisik terfokus pada keluhan utama dilakukan dan "
        f"temuan dicatat sesuai kondisi pasien saat ini.\n"
        f"A: {assessment} ({icd}).\n"
        f"P: Tatalaksana diberikan berupa {plan}. Pasien diedukasi mengenai penyakit, pengobatan, "
        f"dan dianjurkan kontrol kembali sesuai jadwal atau bila keluhan memberat."
    )
