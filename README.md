# Tilik — Sistem Integritas Bukti Pelayanan JKN

Tilik detects JKN health-claim fraud (phantom billing / cloning / repeat billing) by making evidence **tamper-evident and traceable**. Flow: adaptor → staging → trust boundary (validate + tokenize + hash) → PostgreSQL canonical store + MinIO object storage → transactional outbox → Python detector worker (3 detectors) → NestJS API (RBAC + audit) → Next.js reviewer portal (case review → decision) with an optional Claude-generated, evidence-grounded summary. Prototype demo for Healthkathon 2026. **Synthetic data only.**

## Stack

Next.js (App Router, TS) · NestJS (TS) · PostgreSQL (Prisma) · Python worker (scikit-learn) · MinIO · Caddy — Docker Compose on a single VPS. Monorepo via pnpm workspaces.

## Repository layout

```
apps/web          Next.js reviewer portal        (Prompt 10+)
apps/api          NestJS API (RBAC + audit)      (Prompt 05+)
packages/shared   Shared TS enums/types          (this phase)
packages/db       Prisma schema + client         (Prompt 02)
services/detector Python detector worker         (Prompt 07+)
data/synthetic    Synthetic data generator       (Prompt 04)
infra             Docker Compose + Caddy + env    (Prompt 03 / 14)
docs              Plans & deliverables (gitignored)
```

## Prerequisites

- **Node ≥ 22.18** (`.nvmrc` pins 22 LTS; Node 24/26 also work).
- **pnpm 10** — install directly (`npm i -g pnpm` or the standalone script). Do **not** rely on Corepack; it is no longer bundled in Node 25+.

## Install

```bash
pnpm install
```

## Build & verify the shared package

```bash
pnpm --filter @tilik/shared build   # dual ESM+CJS + declarations
pnpm typecheck                      # type-checks all workspace packages
pnpm lint
pnpm format:check
```

## Local infrastructure

Postgres + MinIO run via Docker Compose; the app services (web / api / detector) run from the
terminal in dev. First, create the single repo-root `.env` from the authoritative template:

```bash
cp infra/.env.example .env          # then edit .env with real local values
```

Bring up the stores (first run also creates the `tilik-evidence` bucket and the non-owner `tilik_app`
role). Compose reads its interpolation `.env` from its own directory, so the `infra/compose.sh`
wrapper always passes `--env-file ../.env` for you — use it for every compose command:

```bash
cd infra
./compose.sh up -d postgres minio minio-init
./compose.sh ps                      # postgres healthy; minio Up; minio-init Exited (0)
```

> The wrapper just runs `docker compose --env-file ../.env "$@"`. **Do not create `infra/.env`** —
> Compose would auto-load it and silently shadow the single repo-root `.env`.

Apply the schema (Prompt 02), then grant the app role (idempotent — re-run after each migration):

```bash
pnpm --filter @tilik/db migrate:dev
pnpm --filter @tilik/db db:grant
```

### Environment

All services and Prisma load a **single repo-root `.env`** (copied from `infra/.env.example`). `.env`
is gitignored — never commit real secrets. Only `NEXT_PUBLIC_*` vars reach the browser; never prefix
a secret with `NEXT_PUBLIC_`, and start the `web` process with a minimal allow-list, not the whole file.

### Notes

- MinIO uses the `cgr.dev/chainguard/minio` mirror (Docker Hub's `minio/minio` was retired in 2026).
  It runs as non-root and has no in-container healthcheck, so `minio` shows `Up`; `minio-init` exiting
  `0` is the readiness + bucket-created signal. The free tier only offers `:latest` — pin a digest if
  you need reproducibility.
- **Port 5432 collision:** if a local Postgres already listens on `localhost:5432` it shadows the
  Compose one for host connections (`migrate` would hit the wrong DB). Stop it, or remap the Compose
  host port.
- `docker-entrypoint-initdb.d` runs only on a fresh volume — on an existing `tilik-pgdata` volume the
  `tilik_app` role is not recreated; `docker compose --env-file ../.env down -v` to re-init.
- Managed Postgres that forbids `CREATE DATABASE` needs a `SHADOW_DATABASE_URL` for `migrate:dev`; the
  local owner has `CREATEDB`, so the shadow DB just works. App services (web / api / detector) and the
  prod Compose + Caddy arrive in Prompt 14.

Next phases are tracked in `docs/Tilik_Build_Prompts.md` (gitignored locally).
