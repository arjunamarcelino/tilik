# CLAUDE.md

Guidance for AI agents working in this repo. Keep it short and current.

## What this is

Tilik — an evidence-integrity system that detects JKN health-claim fraud by making evidence
**tamper-evident and traceable**. Prototype for Healthkathon 2026. **Synthetic data only.**
Stack: Next.js + NestJS (TS) · PostgreSQL (Prisma 7) · Python detector (scikit-learn) · MinIO · Caddy,
on Docker Compose. Monorepo via **pnpm workspaces**.

## Layout

```
apps/api                      NestJS API (TS)    (Prompt 05 — auth/RBAC/audit shell; Prompt 06 — import pipeline)
apps/web                      Next.js web (TS)   (Prompt 10 — BFF portal: auth/cookie/DAL, role-aware shell, dashboard)
packages/shared               shared TS enums/types
packages/db (@tilik/db)       Prisma schema, migrations, typed client
services/detector             Python worker      (Prompt 07 — outbox poller + tokenizer; 08 — repeat-billing + cloning; 09 — contradiction detector + Finding→Case aggregation) — NOT a workspace package
data/synthetic                data generator     (Prompt 04)    — NOT a workspace package
infra                         Docker Compose + Caddy + env       — NOT a workspace package
docs                          plans / reviews / solutions        — gitignored (local knowledge)
```

## Commands

```bash
pnpm install
pnpm build          # pnpm -r build
pnpm typecheck      # also runs the enum-parity guard in @tilik/db
pnpm lint           # eslint . (ignores infra/, services/, data/, docs/, generated/)
pnpm format:check   # prettier --check .   (fix with: pnpm format)
```

Node ≥ 22.18, **pnpm 10** (install directly; do not rely on Corepack — gone in Node 25+).

## Local infrastructure

```bash
cp infra/.env.example .env                       # single repo-root .env (see below)
cd infra && ./compose.sh up -d postgres minio minio-init
pnpm --filter @tilik/db migrate:dev
pnpm --filter @tilik/db db:grant                 # grant the non-owner app role (after every migrate)
```

`infra/compose.sh` wraps `docker compose --env-file ../.env` — **always use it** (Compose reads its
`.env` from its own dir, but the source of truth is the repo-root `.env`). **Never create `infra/.env`.**

## Conventions that bite (read before editing infra or the DB)

- **Single root `.env`.** Both apps and Prisma load the one repo-root `.env`. It is gitignored — never
  commit real secrets. `packages/db/prisma.config.ts` loads it via `resolve(__dirname, '../../.env')`
  (the package is CommonJS). Only `NEXT_PUBLIC_*` reaches the browser — never prefix a secret with it.
- **Prisma 7.** URL lives in `prisma.config.ts` (not the schema); client uses the `pg` driver adapter.
  `migrate:dev`/`migrate:deploy`; **never `prisma db push`** (bypasses hand-authored SQL). `db:grant`
  runs `prisma db execute --file …` with **no `--url`/`--schema`** (datasource comes from the config).
- **Two-role Postgres + append-only.** Owner runs Migrate; `tilik_app` (non-owner) runs the app.
  Append-only tables (`AuditEvent`/`EvidenceRecord`/`ClaimLine`; `ClaimVersion` content-immutable) are
  enforced by `ENABLE ALWAYS` triggers **and** by withholding UPDATE/DELETE from `tilik_app` in
  `infra/postgres/grant-app.sql` (GRANT CRUD, then role-targeted REVOKE — a table-level `REVOKE … FROM
PUBLIC` is a no-op). Keep that REVOKE list in sync with new append-only tables. Init SQL is a `.sh` (an
  initdb `.sql` can't interpolate `$APP_DB_PASSWORD`). `grant-app.sql` also grants **schema** `USAGE` and
  `REVOKE CREATE ON SCHEMA public FROM PUBLIC`/`tilik_app` so it's **reset-safe**: `prisma migrate reset`
  DROPs+recreates schema `public` (losing the init's grants) → without this the non-owner hits "permission
  denied for schema public". Append-only triggers block `TRUNCATE` too (even under `session_replication_role
=replica`), so a full `migrate reset` — not a partial truncate — is the clean dev reset; re-run `db:grant`
  after. Details: `docs/solutions/integration-issues/prisma-migrate-reset-grant-usage-prompt10.md`.
- **`apps/api` (NestJS 11, CommonJS).** Pinned to Nest **11 + CJS** to match `@tilik/db`'s `moduleFormat:cjs`
  (v12 is ESM-first — don't upgrade blindly). The API connects as the **non-owner `tilik_app`** via
  `APP_DATABASE_URL` (never `DATABASE_URL`), **never runs migrations**, and asserts `current_user='tilik_app'` at
  boot — so `getPrisma()` (owner URL) is ESLint-banned under `apps/api/src`; it builds its own `PrismaService` on the
  pg adapter. Audit writes use **either** `@Audit` (interceptor; authenticated, state-changing, sole-record actions)
  **or** `AuditService.recordInTx()` (domain mutations, atomic) — never both (a request marker enforces it). The two
  `Role` enums (`@tilik/shared` nominal vs Prisma structural union) don't overlap — bridge with `toDomainRole`. Run
  it: `pnpm --filter @tilik/api start:dev`. Details:
  `docs/solutions/integration-issues/nestjs-11-cjs-api-skeleton-nonowner-rbac-audit.md`.
- **Import pipeline (`apps/api/src/imports`, Prompt 06) — the trust boundary.** `POST /v1/imports` (multipart;
  `@Roles(REVIEWER)`) runs parse→**validate→resolve→stage→write**. **Never store a raw patient id:** validation runs
  **before** staging, so `StagingRecord.raw` holds the redacted/validated shape (accepted episodes keep `patientRef`→
  token; rejected records store `{}`), with `rawHash` = sha256 of the record's RFC-8785 canonical JSON as tamper-evidence.
  `patientToken` + `contentHash` are computed **import-side** (specs in `@tilik/shared/tokenization` + `imports/canonical.ts`,
  pinned by `test-vectors/tokenization.vectors.json` — the Python detector must match it; run `pnpm --filter @tilik/api
test:vectors`). **The whole batch is ONE `$transaction`** — staging + every episode's canonical rows + its
  `DETECT_EPISODE` `OutboxJob` + finalize + the `IMPORT` audit — so `FAILED` means nothing committed (no orphan detect
  jobs). Duplicate `ref`/`claimNo` and dangling refs are rejected in `resolve` (per-record, counted — never a tx-aborting
  500). Audit: a standalone `IMPORT_STARTED` at key-claim + exactly one `recordInTx` `IMPORT` at finalize (no `@Audit` on
  the route). Idempotency is **per-actor** (`@@unique([uploadedBy, idempotencyKey])`). `OutboxJob.type`/`AuditEvent.action`
  are plain strings from **`@tilik/shared/constants`** (a subpath, NOT the root barrel — an `as const` object there would
  trip `check-enum-parity.ts`). Provenance/submission columns are DB-immutable via column-guard triggers
  (`tilik_claimversion_guard`/`tilik_episode_guard` on `importBatchId`; `tilik_stagingrecord_guard` on `raw`/`rawHash`).
  First `$transaction` + MinIO consumer; seed the demo with `pnpm --filter @tilik/api import:seed` (API running + `SEED_ADMIN_*` set).
- **Detector worker (`services/detector`, Python, Prompt 07) — the outbox consumer.** Python (not a pnpm
  workspace; mirrors `data/synthetic`'s layout — hatchling, exact-pinned deps, per-dir `.venv`, pytest). It
  **consumes** the `DETECT_EPISODE` outbox the import pipeline fills: poll → claim → load episode →
  `run_detectors(episode, corpus, cfg)` (Prompt 08: REPEAT_BILLING + CLONING; 09: PERTENTANGAN_BUKTI) →
  **aggregate** (Prompt 09) + mark `DONE`. The single write tx is now
  `insert Findings → insert bertentangan EvidenceLinks → upsert the episode's Case (+ recompute its
severity from the attached findings) → insert a DETECT AuditEvent → mark_done` — all four tables
  (`Finding`/`EvidenceLink`/`Case`/`AuditEvent`) in ONE lease-fenced tx with `mark_done` LAST, so a
  preempted worker rolls the whole group back. `AUDIT_ACTION.DETECT` is a cross-service string pinned both
  sides via `test-vectors/audit-contract.json` (like `DETECT_EPISODE`). **`Case` is two-writer**: the
  worker owns its _existence_ + derived `severity` (the upsert's `DO UPDATE` deliberately touches only
  `severity`/`updatedAt`), the API (Prompt 11) owns `status`/`assignedTo`/`summary`/`Decision` — never add
  a reviewer-owned column to that `DO UPDATE` list. DB access is raw
  **psycopg3** as the **non-owner `tilik_app`** via `APP_DATABASE_URL` (ESLint has no reach here, so a pytest
  **source guard** forbids a bare `DATABASE_URL` key + asserts placeholder-only SQL); it asserts
  `current_user='tilik_app'` at boot/after every reconnect and **never runs migrations**. The claim is ONE
  atomic `UPDATE … (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING` (**claim-then-release**); every
  terminal/requeue UPDATE is **lease-fenced** (`WHERE id=… AND status='PROCESSING' AND lockedBy=worker`) and
  aborts the tx on `rowcount=0`, so the stale-lock reaper can't cause a double-insert (backstopped now by
  `Finding.dedupeKey` + `@@unique` + `ON CONFLICT DO NOTHING` — see Prompt 08 below). `load_episode` reads
  under one **REPEATABLE READ** snapshot (deterministic detector
  input); the `Episode` contract carries all claim versions (+lines), evidence, and **`EvidenceLink`s**
  (`relation='bertentangan'` is the PERTENTANGAN_BUKTI signal). Gotchas: the Prisma `?schema=` DSN param must
  be normalized (libpq rejects it); Prisma `DateTime` columns are **naive** → coerce UTC at the repo
  boundary; enums are hand-mirrored `StrEnum`s (no parity guard). Parity is pinned by shared fixtures —
  `test-vectors/tokenization.vectors.json` (tokenizer) and `test-vectors/outbox-contract.json` (job type);
  assert both sides with `pnpm --filter @tilik/api test:vectors`, `… test:contract`, and the detector's
  `pytest`. DB integration tests need an **isolated** DB (`DETECTOR_TEST_DATABASE_URL`) or they skip — never
  run them against a dirty outbox. Stale-lock reaper + PERTENTANGAN_BUKTI + Docker/Compose are Prompts
  08-reaper/09/14. Details:
  `docs/solutions/integration-issues/python-detector-worker-outbox-psycopg3.md`.
- **Detectors 1 & 2 (`repeat_billing.py` + `cloning.py`, Prompt 08).** Detectors are **pure functions** over
  `Episode` (+ an injected `corpus`) + `Config`; `run_detectors(episode, corpus, cfg)` is the only seam the
  worker calls. **`Finding` idempotency:** a `Finding.dedupeKey` column + `@@unique([episodeId, detector,
dedupeKey])` + `ON CONFLICT DO NOTHING` make re-detection safe (no natural key otherwise). The key MUST be
  **corpus-invariant** (repeat-billing: `sha256(canonical_json([code, sorted(claimNos)]))` — NOT a `"|"`-join,
  `claimNo` is unconstrained; cloning: `sha256(record.id)` — NOT the matched set, which grows). `insert_findings`
  must **never inspect rowcount** (a conflict-skip is success; the lease fence stays on the OutboxJob UPDATEs).
  **Repeat billing** keys on the `PROCEDURE` `ClaimLine.code` (NOT `inacbgCode`, which is random per claim):
  non-repeatable code on ≥2 distinct `claimNo`s, same patient + same UTC day; collapse claim history, drop
  CANCELLED/ENTERED_IN_ERROR, remove exception codes first. **Cloning** is cross-episode: the worker loads the
  whole-DB corpus via `repository.load_clone_corpus` as a **separate autocommit read** (between the episode
  snapshot and the write tx), gated by `detectors.needs_corpus(episode)`. TF-IDF cosine over **word 1–3-grams**,
  and the load-bearing trick — **`max_df` (drop corpus-common terms), NOT idf, is what separates copied
  CONTENT from shared STRUCTURE**: exact-duplicate SOAP templates score cosine 1.0 regardless of idf (it
  cancels), so without `max_df` cloning over-flags clean/template episodes. `CLONING_MIN_CORPUS` is a real
  floor (a k-member clone needs `k ≤ max_df·N`), not idf-stability flavor. Stay on the **sparse path** (never
  densify) for deterministic scores; scores drift as the corpus grows (only the dedupe-key identity is
  stable). Thresholds/exception-codes are env (`Config.from_env`, NaN/inf/0 rejected); other tuning is module
  constants. `strip_boilerplate`'s narrative-line prefixes are a **consumed contract** pinned in
  `test-vectors/narrative-format.json` (asserted both sides). scikit-learn + its full closure are exact-pinned.
  Test precision against the **real synthetic manifest** (assert exactly the planted set flags), not just hand
  fixtures. Details: `docs/solutions/integration-issues/detectors-repeat-billing-cloning-tfidf.md`.
- **Detector 3 (`pertentangan.py`, Prompt 09) — evidence contradiction, pure rule.** A surgical procedure
  (code in a module-constant set, fixture-coupled to `SURGICAL_PROCEDURES`) billed with **no `mendukung`
  support**: support absent + a `sumber` anchor present → `HIGH` (+ emits one `bertentangan`
  `EvidenceLinkDraft`); support present but all captured after `submittedAt` → `MEDIUM` (needs-more-info, **no
  link** — the doc already `mendukung`-supports the claim, so a `bertentangan` link would self-contradict);
  support timely → clean; no evidence at all → **abstain** (no anchor; that's REPEAT_BILLING's episode). The
  `diagnosis→lab` rule is deliberately **not** built (it would false-positive on every diagnosis-without-lab
  episode). dedupe key is `sha256(canonical_json([claim_no, code]))` (NOT `cv.id` — resubmission-stable).
  **Writes:** the `bertentangan` relation is hard-coded in `repository.insert_evidence_links` (the detector
  never writes `sumber`/`mendukung`); `Case.severity` is recomputed from the **persisted** findings (enum
  `max()` = declaration order), not the drafts. Details:
  `docs/solutions/integration-issues/detector-contradiction-case-aggregation-prompt09.md`.
- **Web portal (`apps/web`, Next.js 16 App Router + Tailwind v4 + strict TS, Prompt 10) — a BFF, not a
  direct API client.** The JWT lives in an **httpOnly cookie** on the portal origin; a `server-only` DAL
  (`src/lib/dal.ts`) forwards it as `Authorization: Bearer` to the API (CORS `credentials:false`, Bearer-only)
  — the token never reaches browser JS. **`GET /v1/auth/me` is the single identity + liveness source** (its
  401 = logged-out), so the web has **no `JWT_SECRET`/JWT lib**. Login/logout are **Server Actions**; the
  dashboard reads **`GET /v1/cases/stats`** (both endpoints added Prompt 10 — new `CasesModule`, non-owner
  `PrismaService`, read-only; `CasesModule` must never write the detector-owned `Case.severity`/existence —
  two-writer contract). `proxy.ts` (Next 16 renamed **Middleware→Proxy**) is optimistic-redirect only + emits
  a **per-request nonce CSP** (a static `script-src 'self'` blocks Next's inline scripts → no hydration).
  The single root `.env` reaches Next's render workers only via a **`NODE_OPTIONS=--import ./load-env.mjs`
  preload** (not `next.config`); it prunes to a web allow-list (`NEXT_PUBLIC_API_URL`/`WEB_PORT`) and must
  **not** leak `NODE_ENV` into `next build` (Next owns it). Response DTOs live in the types-only
  **`@tilik/shared/contracts`** subpath, pinned web-side with zod `satisfies z.ZodType<…>`; the role
  hierarchy (`roleSatisfies`) is shared from `@tilik/shared` (API guard + web DAL). Verify hydration/CSP in a
  **browser**, never trust a curl 200. Run it: `pnpm --filter @tilik/web dev`. Details:
  `docs/solutions/integration-issues/nextjs-16-portal-bff-env-csp-prompt10.md`.
- **Enums have one source of truth.** Values live in `@tilik/shared`, mirrored in `schema.prisma`;
  `packages/db/scripts/check-enum-parity.ts` fails `typecheck` on drift. Use `@tilik/shared` enums at
  DTO/validation/API boundaries, Prisma enums only at the persistence edge.
- **MinIO.** Docker Hub's `minio/minio` was retired in 2026 — use the `cgr.dev/chainguard/minio` mirror
  (digest-pinned; distroless + non-root, so no in-container healthcheck — readiness is the `minio-init`
  sidecar exiting 0).
- **Synthetic data generator (`data/synthetic`, Python, `Faker` only).** Output is byte-reproducible only
  for the **pinned toolchain** (`Faker==` + CPython) + `PYTHONHASHSEED=0` + fixed `--seed`; `checksums.txt`
  is the cross-machine golden file (a same-machine `diff` can't prove it). A no-PII guard (allow-list Faker
  facade + pre-write digit scan) fails the run on any plausibly-real identifier — note **Python** Faker
  `id_ID.ssn()` is US-format, _not_ a NIK (that myth is FakerPHP). The generated bundle
  (`data/synthetic/out/`) is gitignored **and** in `.prettierignore` (prettier scans the working tree, not
  `.gitignore`). Details: `data/synthetic/README.md` +
  `docs/solutions/integration-issues/deterministic-nopii-synthetic-data-python.md`.
- **`docs/` is gitignored.** Plans, reviews, and `docs/solutions/*` are local knowledge, not committed.
  Check `docs/solutions/` for prior fixes before researching a problem.

## Commits

Conventional-commit messages (`type(scope): …`), authored by the repo owner. **No tool-generated
trailers, badges, or `Co-Authored-By` lines** — keep history free of AI-authorship footers. Branch
from `main`; don't commit to `main` directly.

Build phases are tracked in `docs/Tilik_Build_Prompts.md` (gitignored locally).
