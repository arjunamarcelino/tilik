#!/bin/sh
# Thin wrapper so `--env-file ../.env` is never forgotten.
#
# Compose reads its interpolation .env from THIS directory by default, but Tilik's single source of
# truth is the repo-root .env. Forgetting the flag makes every ${VAR} interpolate empty (opaque
# "password not specified" errors). Run every compose command through this script instead:
#
#   ./compose.sh up -d postgres minio minio-init
#   ./compose.sh ps
#   ./compose.sh down -v
#
# Do NOT create infra/.env — Compose would auto-load it and silently shadow the repo-root .env.
exec docker compose --env-file ../.env "$@"
