# syntax=docker/dockerfile:1
# Tilik one-shot demo seed. Build context is the REPO ROOT.  docker build -f infra/seed.Dockerfile -t tilik-seed .
#
# REUSES the already-built api runtime image instead of recompiling the workspace: the api image already
# ships the compiled dist/scripts/import-seed.js + its pruned prod node_modules (incl. dotenv) and runs as
# non-root `node`. So the seed image is just "api image + a frozen synthetic bundle". This requires the api
# image to EXIST FIRST — `./compose.sh -f docker-compose.prod.yml build api` (or `up -d --build`) tags it
# `tilik-prod-api:latest`; then `--profile seed run --rm seed` builds this. (Override API_IMAGE to repoint.)
#
# Determinism: the bundle is generated once at build (PYTHONHASHSEED=0, --seed 42, pinned Faker) and frozen
# into the image, so re-running replays the same manifest hash via the importer's Idempotency-Key.

ARG API_IMAGE=tilik-prod-api:latest
# Byte-reproducibility of the bundle holds only for a PINNED toolchain. Override SEED_PYTHON_IMAGE with a
# DIGEST (python:3.11-slim-bookworm@sha256:...) in prod — the floating tag can drift across rebuilds, which
# changes the manifest hash → a fresh (non-replay) import against an already-seeded DB. See DEPLOY.md §5.
ARG SEED_PYTHON_IMAGE=python:3.11-slim-bookworm

# ── bundle: generate the frozen synthetic data (deterministic) ───────────────────────────────────────
FROM ${SEED_PYTHON_IMAGE} AS bundle
ENV PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1
WORKDIR /gen
COPY data/synthetic/ ./
RUN --mount=type=cache,target=/root/.cache/pip pip install . \
 && python generate.py --episodes 60 --seed-fraud --seed 42 --out /bundle

# ── runtime: the api image + the baked bundle, running the compiled importer ─────────────────────────
FROM ${API_IMAGE} AS runtime
ENV BUNDLE_DIR=/bundle
COPY --from=bundle --chown=node:node /bundle /bundle
# NODE_ENV/TZ/WORKDIR(/app)/USER(node) are inherited from the api image. SEED_API_BASE + SEED_ADMIN_* come
# from compose env. Idempotent re-runs (same frozen bundle → same Idempotency-Key).
CMD ["node", "dist/scripts/import-seed.js"]
