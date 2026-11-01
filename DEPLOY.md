# Deploying Tilik

Production deployment of the full Tilik stack to a single VPS, behind Caddy (TLS), with migrations applied
on deploy and a one-command synthetic seed. **Synthetic data only** — this is a Healthkathon 2026 prototype.

Two paths are covered: a **plain VPS** (`docker compose`, Caddy owns TLS) and **Coolify** (its proxy owns
TLS; drop Caddy). The plain path is the reference; Coolify notes are at the end.

---

## 1. What runs

`infra/docker-compose.prod.yml` brings up: `postgres`, `minio` (+ `minio-init`), a one-shot `migrate`,
`api` (NestJS), `web` (Next.js BFF), `detector` (Python worker), and `caddy` (TLS edge). A profiled
one-shot `seed` populates the demo on demand.

Startup order is enforced by `depends_on`: `postgres (healthy) → migrate (completes) → api/detector`;
`minio → minio-init (completes) → api`; `api (healthy) → seed`. Only **Caddy** publishes host ports
(80/443); Postgres and MinIO are reachable only on the internal Docker network.

---

## 2. Prerequisites

- **VPS** ~2 vCPU / 4 GB, Docker Engine + the Compose plugin installed.
- **DNS**: an `A` record for your domain → the VPS public IP, in place **before** first deploy (Caddy
  needs it to get a Let's Encrypt cert). If you also set an `AAAA`, it must point at this box too, or ACME
  may validate over IPv6 and fail.
- **Firewall**: open **only 80 and 443** inbound. Do **not** publish 5432/9000/9001 — the prod compose
  publishes nothing for Postgres/MinIO by design. ⚠️ Security relies on _not publishing_ those ports, **not**
  on UFW: Docker inserts its own iptables rules ahead of UFW, so a published port is reachable regardless of
  a UFW "deny". If you ever must expose one for debugging, bind it to `127.0.0.1:` and reach it via SSH tunnel.
- **Swap**: building three multi-stage images on 4 GB can OOM. Add swap, or build off-box:
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Build platform**: if you build on an Apple-Silicon machine for an amd64 VPS, build with
  `docker buildx build --platform linux/amd64 …` or you'll ship un-runnable arm64 images. Building on the
  VPS itself (or Coolify) avoids this.
- **Anthropic**: a valid `ANTHROPIC_API_KEY` **with `claude-opus-4-8` enabled** on the account/region — a
  valid key with the model disabled passes a `/v1/models` check but fails the demo summary. Verify with a
  1-token `messages` call against `claude-opus-4-8`.

---

## 3. Configure secrets (`.env`)

All secrets come from a single repo-root `.env` on the host — **never committed**.

```bash
git clone <repo> tilik && cd tilik
cp infra/.env.example .env
chmod 600 .env            # owner-only
```

Fill in every value (generate secrets with `openssl rand -base64 32`). Required set:

| Var                                              | Notes                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD`            | owner role (migrate only)                                                                                                    |
| `APP_DB_PASSWORD`                                | non-owner `tilik_app` password (first-boot role creation)                                                                    |
| `DATABASE_URL`                                   | **owner** URL → `…@postgres:5432/tilik?schema=public` (migrate only)                                                         |
| `APP_DATABASE_URL`                               | **non-owner** URL → `…@postgres:5432/tilik?schema=public` (api + detector)                                                   |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`        | MinIO admin                                                                                                                  |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`          | the api's object-store creds — **distinct from the root user** (minio-init provisions a scoped user; see §8)                 |
| `PATIENT_TOKEN_HMAC_KEY`                         | ≥44 random bytes. **Rotate-never** — it keys tokenization + content hashes; changing it after any import de-syncs the corpus |
| `JWT_SECRET`                                     | ≥44 chars                                                                                                                    |
| `ANTHROPIC_API_KEY`                              | server-side only; never logged                                                                                               |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`       | prod boot **requires** the password or the api refuses to seed                                                               |
| `SEED_REVIEWER_EMAIL` / `SEED_REVIEWER_PASSWORD` | same                                                                                                                         |
| `TILIK_DOMAIN`                                   | your FQDN (or `localhost` for an internal-CA test)                                                                           |
| `CORS_ORIGIN`                                    | `https://<your-domain>` (set literally — dotenv does not interpolate)                                                        |
| `NEXT_PUBLIC_API_URL`                            | `http://api:3001` (internal; the browser never calls it)                                                                     |
| `NODE_ENV`                                       | `production`                                                                                                                 |
| `SEED_API_BASE`                                  | `http://api:3001`                                                                                                            |

The hostnames in both DB URLs must be `postgres` (the compose service name), not `localhost`.

---

## 4. Deploy

Run from `infra/` via the wrapper (it passes `--env-file ../.env` so the root `.env` is used):

```bash
cd infra
./compose.sh -f docker-compose.prod.yml up -d --build
```

The `migrate` one-shot runs `prisma migrate deploy && db:grant` and exits 0 **before** the api starts.
Caddy provisions a Let's Encrypt cert for `TILIK_DOMAIN` (or an internal-CA cert for `localhost`).

---

## 5. Seed the demo (one command, idempotent)

```bash
cd infra
./compose.sh -f docker-compose.prod.yml --profile seed run --rm seed
```

The seed image **reuses the already-built api image** (`FROM tilik-prod-api:latest`) plus a **frozen**
synthetic bundle (generated at build with `--seed 42`, `PYTHONHASHSEED=0`), so it adds no second workspace
compile. It therefore requires the api image to exist first — step 4's `up -d --build` (or
`compose build api`) tags it; run the seed only after. It POSTs the bundle to the api; re-running **replays**
(same manifest → same `Idempotency-Key`) — no duplicates.

> **Reproducibility across rebuilds:** the "frozen" guarantee holds for a _given built image_. Byte-equality
> across rebuilds needs a pinned toolchain — the bundle stage's base floats (`python:3.11-slim-bookworm`).
> For a reproducible bundle, build the seed image with a digest: `--build-arg SEED_PYTHON_IMAGE=python:3.11-slim-bookworm@sha256:<digest>`.
> If a rebuilt bundle's bytes drift, its hash changes and re-seeding an **already-seeded** DB becomes a fresh
> import (duplicate append-only rows). Re-seed only onto a fresh DB, or keep the same seed image.

---

## 6. Verify (Go/No-Go)

`C = ./compose.sh -f docker-compose.prod.yml`. DB queries: `C exec postgres psql -U "$POSTGRES_USER" -d tilik`.

1. `C ps` — `migrate` + `minio-init` show `exited (0)`; `api`/`web`/`detector`/`caddy`/`postgres` are `Up`
   (api `healthy`).
2. **Grants bound** (the load-bearing invariant — proves `db:grant` ran):
   ```sql
   SELECT has_table_privilege('tilik_app','"AuditEvent"','UPDATE')   AS ae_update,    -- expect f
          has_table_privilege('tilik_app','"Decision"','UPDATE')     AS dec_update,   -- expect f
          has_table_privilege('tilik_app','"EvidenceRecord"','DELETE')AS er_delete,   -- expect f
          has_table_privilege('tilik_app','"ClaimLine"','INSERT')    AS cl_insert,    -- expect t
          has_schema_privilege('tilik_app','public','USAGE')         AS schema_usage, -- expect t
          has_schema_privilege('tilik_app','public','CREATE')        AS schema_create;-- expect f
   ```
   Any `*_update = t` or `schema_usage = f` → `db:grant` didn't apply → the api crash-loops on its
   `current_user` assertion. Fix: `C run --rm migrate` (re-runs grant; idempotent), then `C restart api`.
3. `C exec api wget -qO- http://127.0.0.1:3001/health` → `{"status":"ok","db":"up"}` (a 200 also proves the
   api connected as `tilik_app`).
4. **web holds no secrets**:
   `C exec web printenv | grep -iE 'JWT_SECRET|ANTHROPIC|PATIENT_TOKEN|MINIO|SEED_|^DATABASE_URL='` → empty.
5. In a **browser** at `https://<domain>`: the portal hydrates with no CSP error in the console (proves the
   env preload fired + the nonce CSP). A curl 200 does not prove this.
6. After seeding:
   ```sql
   SELECT status, count(*) FROM "OutboxJob" WHERE type='DETECT_EPISODE' GROUP BY status;  -- all DONE
   SELECT detector, count(*) FROM "Finding" GROUP BY detector;  -- REPEAT_BILLING/CLONING/PERTENTANGAN_BUKTI
   ```
   Re-run the seed and confirm `ImportBatch`/`Case` counts are unchanged (idempotent).
7. The grounded summary **streams token-by-token in a browser** through Caddy (not curl).

---

## 7. First boot vs redeploy (gotchas)

- **Postgres role + password are set once**, on the first init of an empty `tilik-pgdata` volume
  (`postgres/init/01-app-role.sh`). Changing `POSTGRES_PASSWORD`/`APP_DB_PASSWORD` in `.env` after that is a
  **silent auth break** (the role keeps the old password). To rotate:
  `ALTER ROLE tilik_app PASSWORD '…';` (and the owner) to match `.env`, then `C restart api detector`.
- **User seed is find-then-skip**: changing `SEED_ADMIN_PASSWORD` on redeploy is a no-op. Reset it with a
  short SQL/CLI step, not by editing `.env`.
- **`db:grant` runs every deploy** (it's in the migrate entrypoint) — correct, because the Decision/append-only
  REVOKEs ship no migration of their own.
- **Cert persistence**: the `tilik-caddy-data` volume holds the LE cert/account — keep it across redeploys or
  you re-provision and can hit the LE rate limit.

---

## 8. Storage hardening (built in)

The prod `minio-init` extends the evidence-integrity guarantee to storage automatically — no manual steps:

- **Scoped MinIO user (built in)**: `minio-init` provisions a least-privilege IAM user from
  `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` with a policy allowing only `s3:GetObject`/`s3:PutObject` on the
  bucket (+ bucket-level `ListBucket`/`GetBucketLocation` for the api's `bucketExists` probe) — **no**
  `DeleteObject`, no bucket admin, never the root creds. So in `.env` these two vars **must be distinct from
  `MINIO_ROOT_USER`** (secret ≥8 chars). A compromised api therefore can't wipe or rewrite every object.
  **Verify** after deploy (from a transient mc container on the stack network):
  ```bash
  docker run --rm --network tilik-prod_default --entrypoint sh minio/mc -c \
    'mc alias set m http://minio:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" && mc rm m/tilik-evidence/anything 2>&1 | grep -qi "access denied" && echo "DELETE denied — scoped OK"'
  ```
- **Bucket WORM (built in)**: the bucket is created `--with-lock`, which enables object-lock capability +
  versioning, so overwrites/deletes leave prior versions behind (tamper-evident). A hard **default
  retention** (`mc retention set --default GOVERNANCE <dur>`) is intentionally **not** applied — it could
  block a legitimate re-import — enable it once you've confirmed your write pattern needs hard immutability.
- **If the api fails to boot** with a MinIO `AccessDenied`, the scoped policy is too tight for how the client
  probes the bucket — check `MINIO_ACCESS_KEY` is distinct from root and that `minio-init` exited 0.
- **Secrets at rest (optional)**: for the owner `DATABASE_URL`, `ANTHROPIC_API_KEY`, `PATIENT_TOKEN_HMAC_KEY`,
  consider Compose `secrets:` (file-mounted) so they don't appear in `docker inspect`. Never mount the Docker
  socket into an app container (socket access == full secret disclosure).

---

## 9. Backup / restore (optional)

Data is **synthetic and reproducible**, so the simplest recovery is **redeploy + re-seed**. If you want real
backups, capture both stores in the **same quiesced window** (evidence integrity compares live object bytes to
the append-only DB `contentHash`; a skewed snapshot → `EVIDENCE_INTEGRITY_FAILED`/409 on download):

```bash
C stop api detector                                    # freeze writers
C exec postgres pg_dump -U "$POSTGRES_USER" -Fc tilik > tilik.dump
# mirror MinIO from a transient mc container in the same window (mc mirror m/tilik-evidence ./minio-backup)
C start api detector
```

Restore onto a **fresh** volume (roles are cluster-level, recreated by `01-app-role.sh`), `pg_restore`
**without `--clean`** (append-only triggers block it), then re-run `migrate` for `db:grant`, then restore the
matching MinIO snapshot.

---

## 10. Troubleshooting

| Symptom                                   | Cause / fix                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api restarts, logs `expected 'tilik_app'` | `db:grant` didn't run → `C run --rm migrate`; or `APP_DATABASE_URL` points at the owner                                                                                       |
| Caddy can't get a cert                    | DNS not propagated / port 80 unreachable; for dry runs set `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` (don't wipe `tilik-caddy-data` to force re-issue) |
| seed can't reach the API                  | `SEED_API_BASE` must be `http://api:3001`; run via `--profile seed` so `depends_on: api healthy` holds                                                                        |
| web: `NEXT_PUBLIC_API_URL not set`        | the `load-env.mjs` preload didn't fire — don't bypass the image `CMD`                                                                                                         |
| summary doesn't stream                    | verify in a browser through Caddy (the route carries `flush_interval -1`); on Coolify, Traefik streams unbuffered by default                                                  |
| detector idle                             | no `DETECT_EPISODE` jobs — the seed didn't run, or jobs are already `DONE`                                                                                                    |
| build OOM on the VPS                      | add swap, or build images off-box and `docker compose pull`                                                                                                                   |

---

## 11. Deploying via Coolify

Coolify runs its own proxy (Traefik) on 80/443 and gives git-push deploys — so **no GitHub Actions is
needed**.

- **Source**: Docker Compose build pack; Base Directory `/`, Compose Location `infra/docker-compose.prod.yml`.
- **Proxy/TLS (Mode A, recommended)**: **drop the `caddy` service** (don't publish 80/443 — it collides with
  Traefik). Add two Coolify **Domains** on your hostname: `https://host/v1` → `api:3001` and `https://host/` →
  `web:3000`, with **"Keep paths as-is"** so `/v1/...` reaches the api intact. Traefik terminates TLS and
  streams unbuffered by default (the summary works with no `flush_interval`). **Do not** enable Coolify's
  per-domain security-headers middleware on the web domain — a static CSP there would break the app's nonce
  CSP.
- **Secrets**: enter them in Coolify's UI (not committed); `${VAR:?}` blocks a deploy when one is empty. A
  Coolify host compromise exposes all secrets, so harden the dashboard (TLS + auth + 2FA), pin auto-deploy to
  a protected branch, and confirm the GitHub webhook signature is enforced.
- **One-shots**: the `depends_on: service_completed_successfully` chain is honored. Add `exclude_from_hc: true`
  to the `migrate`/`seed` services in a Coolify overlay (it's omitted from the committed compose because it is
  not a standard Compose key).
- **Volumes**: named volumes persist across redeploys (Coolify prefixes their names); decide managed-vs-external
  up front for pgdata/minio.
