# services/detector

Python detector worker — polls the PostgreSQL transactional outbox (`OutboxJob`), claims `DETECT_EPISODE`
jobs safely under concurrency, loads the episode, runs the detectors, and writes `Finding`s. **Prompt 07**
ships the reliable loop + a byte-identical patient tokenizer + a **no-op** `run_detectors()` stub; the three
real detectors (repeat billing, cloning, pertentangan bukti) land in Prompts 08–09.

Not a pnpm workspace package (it's Python). It connects to the **same** Postgres Prisma owns as the
**non-owner `tilik_app`** role and **never runs or alters migrations** — Prisma owns the schema.

## Layout

```
detector/
  config.py      Config.from_env() — fail-fast; reads APP_DATABASE_URL only (no owner fallback); redacting repr
  log.py         stdlib logging → JSON stdout (never logs secrets / patient tokens / claim content)
  tokenizer.py   patientToken HMAC — byte-identical to the API (see parity below)
  db.py          psycopg3 connect (non-owner boot assertion, keepalives, timeouts, Prisma-DSN normalization)
  models.py      StrEnums + the Episode/*View input contract + the FindingDraft output contract
  repository.py  all SQL: atomic claim, batched episode load, lease-fenced DONE/requeue/FAIL, findings insert
  detectors.py   run_detectors(episode) -> list[FindingDraft]  (STUB: returns [] in Prompt 07)
  worker.py      the poll loop, error taxonomy, graceful shutdown, `python -m detector.worker`
tests/           pure tests (tokenizer vectors, error classification, payload validation) + DB integration
```

## Setup

```bash
cd services/detector
uv venv .venv                     # or: python -m venv .venv
uv pip install --python .venv -e '.[dev]'   # or: .venv/bin/pip install -e '.[dev]'
```

## Run

The worker reads config from the environment (no `.env` auto-load):

| Variable                    | Required | Default | Notes                                                                                |
| --------------------------- | -------- | ------- | ------------------------------------------------------------------------------------ |
| `APP_DATABASE_URL`          | yes      | —       | **non-owner** `tilik_app` DSN; the worker asserts `current_user='tilik_app'` at boot |
| `DETECTOR_POLL_INTERVAL_MS` | no       | `1000`  | idle poll interval                                                                   |
| `DETECTOR_MAX_ATTEMPTS`     | no       | `5`     | requeue a transient failure until this many attempts, then `FAILED`                  |
| `LOG_LEVEL`                 | no       | `info`  |                                                                                      |

```bash
# from the repo root: bring up infra + seed jobs (Prompt 06), then run the worker
cd infra && ./compose.sh up -d postgres minio minio-init && cd ..
pnpm --filter @tilik/db migrate:deploy && pnpm --filter @tilik/db db:grant
pnpm --filter @tilik/api import:seed        # enqueues DETECT_EPISODE jobs (needs the API running + SEED_ADMIN_*)

export $(grep '^APP_DATABASE_URL=' .env)    # or set it yourself
python -m detector.worker                   # watch jobs drain PENDING → PROCESSING → DONE (JSON logs)
```

The worker drains back-to-back while jobs exist and sleeps the poll interval when idle. `SIGTERM`/`SIGINT`
finish the in-flight job, stop claiming, and exit 0.

## Tokenizer parity

`tokenizer.patient_token` reproduces the API's `patientToken` byte-for-byte
(`HMAC-SHA256(key, "patient:" + NFC→strip→upper(ref))` → lowercase hex). Parity is proven against the same
golden fixture the API uses:

```bash
.venv/bin/python -m pytest tests/test_tokenize_vectors.py   # Python side
pnpm --filter @tilik/api test:vectors                       # TypeScript side
```

## Tests

```bash
.venv/bin/python -m pytest        # pure tests always run; DB tests skip unless a test DB is reachable
```

The pure tests (tokenizer vectors, error classification, payload validation) need no database. The DB
integration tests (lifecycle, concurrency, failure) require an **isolated** Postgres so they never claim
real outbox work:

- set `DETECTOR_TEST_DATABASE_URL` to a dedicated migrated+granted database (recommended), **or**
- rely on `APP_DATABASE_URL` — used only if its outbox has **zero** pending `DETECT_EPISODE` jobs; otherwise
  the DB tests skip with an explanatory message.

To create an isolated test DB (owner has `CREATEDB`):

```bash
createdb tilik_test
DATABASE_URL="postgresql://<owner>@localhost:5432/tilik_test?schema=public" pnpm --filter @tilik/db migrate:deploy
DATABASE_URL="postgresql://<owner>@localhost:5432/tilik_test?schema=public" pnpm --filter @tilik/db db:grant
DETECTOR_TEST_DATABASE_URL="postgresql://tilik_app:<pw>@localhost:5432/tilik_test?schema=public" \
  .venv/bin/python -m pytest
```
