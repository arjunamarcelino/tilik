# syntax=docker/dockerfile:1
# Tilik one-shot demo seed. Build context is the REPO ROOT.  docker build -f infra/seed.Dockerfile -t tilik-seed .
#
# Determinism is captured at BUILD time: a Python stage generates the synthetic bundle once (PYTHONHASHSEED=0,
# --seed 42, pinned Faker) and freezes it into the image, so every run replays the SAME manifest hash via the
# importer's Idempotency-Key. A Node stage carries the COMPILED importer (no tsx — a dev dep) which POSTs the
# frozen bundle to the api over the Compose network (SEED_API_BASE).

ARG NODE_IMAGE=node:22-bookworm-slim

# ── bundle: generate the frozen synthetic data (deterministic) ───────────────────────────────────────
FROM python:3.11-slim-bookworm AS bundle
ENV PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1
WORKDIR /gen
COPY data/synthetic/ ./
RUN pip install --no-cache-dir . \
 && python generate.py --episodes 60 --seed-fraud --seed 42 --out /bundle

# ── importer: build the compiled import-seed script + its pruned prod node_modules ───────────────────
FROM ${NODE_IMAGE} AS importer
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm i -g pnpm@10.29.2
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma/ packages/db/prisma/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install -r --offline --frozen-lockfile
COPY . .
RUN pnpm --filter @tilik/shared build \
 && pnpm --filter @tilik/db build \
 && pnpm --filter @tilik/api build \
 && pnpm --filter @tilik/api --prod deploy /prod/api

# ── runtime: Node runs the compiled importer against the baked bundle ────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC BUNDLE_DIR=/bundle
WORKDIR /app
COPY --from=importer --chown=node:node /prod/api ./
COPY --from=bundle --chown=node:node /bundle /bundle
USER node
# SEED_API_BASE (http://api:3001) + SEED_ADMIN_EMAIL/PASSWORD come from compose env. Idempotent re-runs.
CMD ["node", "dist/scripts/import-seed.js"]
