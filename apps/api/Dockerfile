# syntax=docker/dockerfile:1
# Tilik API (NestJS 11, CommonJS) + the one-shot migrate runner, from one multi-stage build.
#
# Build context is the REPO ROOT (monorepo): the pnpm workspace manifests + packages/* must be visible.
#   docker build -f apps/api/Dockerfile --target runtime -t tilik-api .
#   docker build -f apps/api/Dockerfile --target migrate -t tilik-migrate .
#
# bookworm-slim (glibc), not alpine: the build runs `prisma generate` and the `migrate` target runs the
# Prisma schema engine — both native binaries that hit musl/openssl pitfalls on alpine. At RUNTIME the api
# talks to Postgres via the @prisma/adapter-pg driver (pure JS/Wasm, no query engine), so this is a
# build-time correctness choice, not a runtime requirement.

ARG NODE_IMAGE=node:22-bookworm-slim

# ── base: pnpm on slim Node ────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Install pnpm directly — Corepack is gone in Node 25+ (repo convention). Pin to the packageManager version.
RUN npm i -g pnpm@10.29.2
WORKDIR /app

# ── deps: install the workspace, keyed on the lockfile for layer caching ─────────────────────────────
FROM base AS deps
# Manifests + lockfile FIRST so this layer survives source edits. Copy every workspace package.json so the
# frozen lockfile resolves; packages/db/prisma is needed by @tilik/db's `prepare` (prisma generate).
# (Keep this manifest set in sync with apps/web/Dockerfile's deps stage — a new workspace package must be
# added to both or the --frozen-lockfile install fails.)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma/ packages/db/prisma/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
# Install ONLY @tilik/api + its workspace deps (shared, db) — not apps/web's next/react/tailwind. All
# manifests are copied above so --frozen-lockfile still resolves the full lockfile; --filter scopes linking.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter "@tilik/api..." --offline --frozen-lockfile

# ── build: compile shared → db (generate+tsc) → api (nest build) ─────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @tilik/shared build \
 && pnpm --filter @tilik/db build \
 && pnpm --filter @tilik/api build
# Pruned, symlink-free single-package tree for the runtime (drops devDeps incl. tsx + the Prisma CLI).
RUN pnpm --filter @tilik/api --prod deploy /prod/api

# ── runtime (api): the default service image ─────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
# /prod/api carries dist/ (incl. dist/scripts/import-seed.js) + an isolated prod node_modules with the
# @tilik/db dist (which embeds the generated Prisma client) and @prisma/adapter-pg. Run as the built-in
# non-root `node` user. Signals/reaping come from compose `init: true` (the app calls enableShutdownHooks).
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3001
# Probe the unversioned /health (Public, excluded from /v1). A 200 also proves the current_user='tilik_app'
# assertion, since /health runs SELECT current_user. node's built-in fetch — no curl to install.
# interval kept short so `web` (depends_on: api service_healthy) isn't delayed ~30s after the api is up;
# start-period stays generous to cover boot + the current_user assertion + user seed without false failures.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ── migrate: one-shot owner-side migrate + grant (reuses the unpruned build stage) ───────────────────
# Keeps the Prisma CLI (a devDep) + schema + prisma/migrations + prisma.config.ts, and — because the build
# context is the repo root — infra/postgres/grant-app.sql at /app/infra/postgres/… so db:grant's relative
# `../../infra/postgres/grant-app.sql` resolves. Gets the OWNER DATABASE_URL (the only service that does).
# migrate deploy is idempotent; db:grant MUST run every deploy (P12/P13 ship no migration).
FROM build AS migrate
ENV NODE_ENV=production TZ=UTC
CMD ["sh", "-c", "pnpm --filter @tilik/db migrate:deploy && pnpm --filter @tilik/db db:grant"]
