#!/bin/sh
# Provision the NON-OWNER application role (tilik_app).
#
# Runs as $POSTGRES_USER (the schema owner) on the FIRST init of an empty data volume only
# (docker-entrypoint-initdb.d convention). The owner runs Prisma Migrate; tilik_app is what the
# API + detector connect as at runtime so the append-only guarantee (ENABLE ALWAYS triggers +
# role-targeted REVOKEs in grant-app.sql) actually binds — a non-owner, non-superuser can neither
# disable a trigger nor set session_replication_role.
#
# This script reads the password from $APP_DB_PASSWORD (env) and passes it via psql -v so NO literal
# secret is ever stored in a tracked file. Table/sequence grants happen AFTER migrate — see
# ../grant-app.sql (run via `pnpm --filter @tilik/db db:grant`).
set -e
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
	-v app_pw="$APP_DB_PASSWORD" \
	-v dbname="$POSTGRES_DB" \
	--username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
	-- No IF-EXISTS guard needed: initdb.d runs only on a fresh volume, so the role cannot pre-exist.
	CREATE ROLE tilik_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;

	GRANT CONNECT ON DATABASE :"dbname" TO tilik_app;
	GRANT USAGE ON SCHEMA public TO tilik_app;

	-- DDL lock: tilik_app owns nothing, so it cannot create objects in public. This explicit REVOKE
	-- documents that intent. (We don't REVOKE ... FROM PUBLIC — that's already the default on a fresh
	-- PG15+ cluster, which the pinned postgres:16 image always is.)
	REVOKE CREATE ON SCHEMA public FROM tilik_app;
EOSQL
