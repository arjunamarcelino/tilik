# CLAUDE.md

Guidance for AI agents working in this repo. Keep it short and current.

## What this is

Tilik — an evidence-integrity system that detects JKN health-claim fraud by making evidence
**tamper-evident and traceable**. Prototype for Healthkathon 2026. **Synthetic data only.**
Stack: Next.js + NestJS (TS) · PostgreSQL (Prisma 7) · Python detector (scikit-learn) · MinIO · Caddy,
on Docker Compose. Monorepo via **pnpm workspaces**.

## Layout

```
apps/web  apps/api            TS apps            (Prompt 05+/10+)
packages/shared               shared TS enums/types
packages/db (@tilik/db)       Prisma schema, migrations, typed client
services/detector             Python worker      (Prompt 07+)   — NOT a workspace package
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
  `infra/postgres/grant-app.sql` (GRANT CRUD, then role-targeted REVOKE — a `REVOKE … FROM PUBLIC` is a
  no-op). Keep that REVOKE list in sync with new append-only tables. Init SQL is a `.sh` (an initdb
  `.sql` can't interpolate `$APP_DB_PASSWORD`).
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
