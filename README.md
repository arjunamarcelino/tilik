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

Next phases are tracked in `docs/Tilik_Build_Prompts.md` (gitignored locally).
