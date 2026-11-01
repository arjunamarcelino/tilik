# syntax=docker/dockerfile:1
# Tilik web portal (Next.js 16 BFF) — standalone output.
#
# Build context is the REPO ROOT (monorepo).  docker build -f apps/web/Dockerfile -t tilik-web .
# No public/ dir exists in this app, so it is not copied. The env preload (load-env.mjs) is invisible to
# Next's file tracing (it's a NODE_OPTIONS string, never imported), so it MUST be copied in explicitly.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm i -g pnpm@10.29.2
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma/ packages/db/prisma/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install -r --offline --frozen-lockfile

FROM deps AS build
# NEXT_PUBLIC_API_URL is inlined into client bundles at build time. The browser never calls it (pure BFF);
# the BFF reads it server-side at runtime. Default to the internal Compose hostname.
ARG NEXT_PUBLIC_API_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
# @tilik/shared must be built before `next build` (it is transpilePackages'd → traced as source).
RUN pnpm --filter @tilik/shared build \
 && pnpm --filter @tilik/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC
# The standalone server.js honors PORT + HOSTNAME; bind all interfaces inside the container. The preload
# is baked in so `node server.js` always loads/prunes env (cwd = /app/apps/web → ./load-env.mjs resolves).
ENV PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS="--import ./load-env.mjs"
WORKDIR /app
# Monorepo standalone layout: server.js nests under apps/web; node_modules + packages/* hoist to the root.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/load-env.mjs ./apps/web/load-env.mjs
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
