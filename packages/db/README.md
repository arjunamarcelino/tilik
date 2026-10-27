# @tilik/db

Canonical PostgreSQL schema for Tilik. **Prisma is the single source of truth** for the schema; the Python detector (`services/detector`) reads/writes the same tables but never owns migrations.

## Usage

```ts
import { getPrisma, type Case, CaseStatus } from '@tilik/db';

const prisma = getPrisma(); // lazy singleton; Prisma 7 pg driver adapter
```

- `getPrisma()` — lazily-created process-wide client. NestJS wraps the `PrismaClient` class in its own `PrismaService` (it does not use this accessor).
- All model types, the `Prisma` namespace (`Prisma.Decimal`, …), and the generated enums are re-exported from the package root — never import from `src/generated/**` directly.

## Enum convention (two surfaces, one source of truth)

Enum **values** are defined once in `@tilik/shared` and mirrored in `schema.prisma`; `scripts/check-enum-parity.ts` fails `typecheck` if they drift (values **or** completeness). Because `@tilik/db` also re-exports Prisma's generated enums, the same name is importable from both packages with nominally-distinct types. Convention:

- Use **`@tilik/shared`** enums at DTO / validation / API boundaries.
- Use **Prisma** enums only at the persistence edge (query args / results).

## Scripts

| Script                 | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `generate` / `prepare` | generate the client (schema-only, no DB; `prepare` runs on install) |
| `migrate:dev`          | create/apply a migration locally (**dev only** — can reset the DB)  |
| `migrate:deploy`       | apply committed migrations (CI / staging / prod)                    |
| `studio`               | Prisma Studio                                                       |
| `build` / `typecheck`  | compile to `dist/` (CJS) / type-check (runs the enum-parity guard)  |

## Migrations

The init migration appends hand-authored SQL (Postgres features Prisma's schema can't express): append-only triggers (`ENABLE ALWAYS`) + `REVOKE` on the audit/evidence spine, a column-aware `ClaimVersion` guard (content-immutable, lineage-mutable), a partial FIFO index for the outbox, a partial UNIQUE index (one current version per claim), CHECK constraints, and jsonb size ceilings. These replay into the shadow DB, so they do not register as drift. **Never run `prisma db push`** — it bypasses the migration history and this SQL.

> Append-only here means append-only, **not** cryptographic tamper-evidence: a DB superuser/owner can disable a trigger. Run the app as a non-owner role (see `.env.example`); a hash chain on `AuditEvent` is future work.
