# data/synthetic

Synthetic data generator (Python, Faker `id_ID`) — produces fake-but-realistic JKN episodes/claims/evidence,
including deliberately **seeded fraud** cases and **exception** cases that must _not_ be flagged. The output is
a self-describing bundle the import endpoint (Prompt 06) consumes and the detector (Prompt 07) is measured
against. Built in Prompt 04.

> **Synthetic data only — no real JKN data, ever.** No field ever contains a plausibly-real personal
> identifier (no NIK/BPJS/NPWP/phone). A built-in guard enforces this and fails the run otherwise.

`data/synthetic` is **not** a pnpm workspace package; the repo's lint/typecheck/format ignore `data/`. It is a
standalone Python project (one runtime dependency: `Faker`).

## Run

```bash
cd data/synthetic
python -m venv .venv && . .venv/bin/activate
pip install -e .                 # add ".[dev]" for pytest
export PYTHONHASHSEED=0           # part of the reproducibility contract

python generate.py --episodes 60 --seed-fraud --seed 42
cat out/manifest.json
```

| Flag           | Default | Meaning                                                                |
| -------------- | ------- | ---------------------------------------------------------------------- |
| `--episodes N` | `60`    | total episodes to emit                                                 |
| `--seed-fraud` | off     | include the seeded fraud + exception families (without it → all clean) |
| `--seed N`     | `42`    | RNG/Faker seed; fixed → reproducible                                   |
| `--out PATH`   | `out`   | output directory (safely wiped first)                                  |
| `--quiet`      | off     | suppress the summary line                                              |

With `--seed-fraud`, each planted family gets `max(2, episodes × 7 // 100)` episodes; the rest are clean. The
command requires `--episodes ≥ 25` so all five families fit alongside a clean majority.

## The bundle (`out/`)

FK-ordered files; cross-references use synthetic keys (`ep_0001`, `cv_0001`, `ev_0001`) that the importer
resolves to database ids. The generator emits **content only** — it does **not** compute `contentHash`,
`fingerprint`, or the `patientToken` HMAC (those are import-/detector-side).

```
out/
  manifest.json          # generator meta + loadOrder + counts + per-episode ground-truth labels
  episodes.json          # Episode[]            (load first)
  claim-versions.json    # ClaimVersion[] with nested lines[]
  evidence-records.json  # EvidenceRecord[]     (payload XOR file)
  evidence-links.json    # EvidenceLink[]       (relation ∈ mendukung|bertentangan|sumber)
  files/<ref>.{png,pdf}  # dummy file-backed evidence (deterministic bytes)
```

### Import contract (bundle field → DB column)

The bundle field names are not all identical to the Prisma columns; the import endpoint (Prompt 06) applies
this mapping. Surrogate `*Ref` keys are resolved to the real `cuid` ids; derived/tamper-evidence fields are
computed on import and are intentionally absent from the bundle.

| Bundle field                                                           | DB column                                                   | Transform on import                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `ref` (e.g. `ep_0001`)                                                 | `id`                                                        | mint a `cuid`; keep a ref→id map to resolve the `*Ref` fields       |
| `episodes[].patientRef`                                                | `Episode.patientToken`                                      | **HMAC** the ref with the server key (never stored raw)             |
| `*.episodeRef` / `*.claimVersionRef` / `links[].evidenceRef`           | the resolved FK id                                          | look up in the ref→id map (null `claimVersionRef` stays null)       |
| `evidence[].file` (`files/<ref>.ext`)                                  | `EvidenceRecord.objectKey`                                  | upload the file to MinIO, store the object key (upload-then-insert) |
| `evidence[].payload` / `kind` / `capturedAt` / `source` / `ingestedBy` | same-named columns                                          | direct                                                              |
| `claims[]` + `lines[]`, `amount` (string)                              | `ClaimVersion` / `ClaimLine`, `Decimal(14,2)`               | parse the decimal string                                            |
| — (not emitted)                                                        | `contentHash`, `fingerprint`, `isCurrent`, `supersededById` | derived by import/detector                                          |

`manifest.labels` is ground truth for detector precision/recall, not import input.

## Categories

| Category                         | Detector             | Flagged? | What it plants                                                                                  |
| -------------------------------- | -------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `clean`                          | —                    | no       | varied diagnoses/procedures with supporting evidence (the baseline majority)                    |
| `fraud_repeat_billing`           | `REPEAT_BILLING`     | **yes**  | same patient + same day, two claims of the **same non-repeatable** procedure (appendectomy)     |
| `fraud_cloning`                  | `CLONING`            | **yes**  | a cluster of different patients sharing a **byte-identical narrative** (only name/MRN swapped)  |
| `fraud_contradiction`            | `PERTENTANGAN_BUKTI` | **yes**  | a surgical claim with its mandatory `laporan operasi` + `laporan anestesi` **omitted**          |
| `exception_repeatable_procedure` | `REPEAT_BILLING`     | **no**   | same patient, a **legitimately repeatable** procedure (hemodialysis/chemo) repeated across days |
| `exception_soap_template`        | `CLONING`            | **no**   | a cluster sharing the SOAP **scaffold** but with genuinely different clinical content           |

### Why the exceptions matter — the over-flag proof

The two exception families look superficially like the fraud they mirror, but are legitimate:

- **Repeatable vs non-repeatable:** repeating hemodialysis is normal; repeating an appendectomy is not. A
  correct `REPEAT_BILLING` detector keys on the procedure's repeatability class, not raw repetition.
- **Cloning vs standardized form:** cloning copies the _content_ (same clinical story, different patient); a
  SOAP template shares only the _structure_. Measured on word-3-shingle Jaccard, the cloning cluster lands
  ~0.87–0.90 and the SOAP cluster ~0.39–0.42 — any threshold in between (e.g. 0.80) separates them. The
  generator builds the texts so this holds by construction; it does not compute the metric.

## `manifest.json` — ground truth

`labels` has one entry per episode (including `clean`), each with `category`, the target `detector`, and
`expectFinding` (`true` for fraud, `false` for clean/exceptions). This is the ground truth a later
precision/recall harness (Prompt 07+) scores detector output against. `counts` are derived from the emitted
data, never hand-maintained.

## Reproducibility

Byte-for-byte identical output is guaranteed for the **pinned toolchain** (`Faker==40.43.0`, CPython ≥ 3.11),
a fixed `--seed`, and `PYTHONHASHSEED=0`. All timestamps derive from a fixed `BASE_DATE` (no wall-clock), money
is generated as integers, JSON is sorted/UTF-8/`\n`, and dummy files use DEFLATE _stored_ blocks (not
`zlib.compress`, whose bytes vary by zlib build). `checksums.txt` is the committed golden file:

```bash
( cd out && find . -type f | sort | xargs shasum -a 256 ) | diff - checksums.txt && echo OK
```

Bumping Faker (or CPython) may shift values — re-pin deliberately and regenerate `checksums.txt`.

## Tests

```bash
pip install -e ".[dev]"
PYTHONHASHSEED=0 python -m pytest tests/
```

`test_guard.py` covers the no-PII guard (must-flag/must-not-flag corpus + forbidden-provider raises);
`test_determinism.py` covers byte-identity across runs and clean-only mode.
