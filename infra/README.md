# infra

Local + production infrastructure.

| File                     | Purpose                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `docker-compose.yml`     | Local dev: PostgreSQL + MinIO + a one-shot `minio-init` bucket creator.                |
| `compose.sh`             | Wrapper: `docker compose --env-file ../.env "$@"` — use it for every compose command.  |
| `.env.example`           | **Authoritative** system env contract — copy to the repo-root `.env`.                  |
| `postgres/init/*.sh`     | First-init: creates the non-owner `tilik_app` role (reads `APP_DB_PASSWORD` from env). |
| `postgres/grant-app.sql` | Post-migrate CRUD grants + role-targeted REVOKEs on the append-only spine.             |
| `Caddyfile`              | Production reverse-proxy stub (`/v1/* → api`, `/ → web`). Not run locally.             |

Bring-up and conventions are documented in the repo-root `README.md` → **Local infrastructure**.
App services (web / api / detector) run from the terminal in dev; production Compose + Caddy land in
Prompt 14.
