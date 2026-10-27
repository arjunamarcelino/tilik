import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

// Single import point for the API: PrismaClient, the Prisma namespace (Decimal, …),
// every model type, and every generated enum.
export * from './generated/prisma/client';

let client: PrismaClient | undefined;

/**
 * Lazily create the process-wide Prisma client (Prisma 7 requires a driver adapter).
 *
 * Importing `@tilik/db` is side-effect-free: the client and its pg pool are built on the first
 * call, so a type-only or enum-only import never allocates a connection or a duplicate client.
 * NestJS (Prompt 04) wraps the class in its own `PrismaService`; this accessor is for scripts/seeds.
 *
 * Pooling: PrismaPg uses node-postgres' default pool (max 10). The outbox relay holds a connection
 * per `FOR UPDATE SKIP LOCKED` job, so size the pool to worker concurrency (and prefer transaction-mode
 * PgBouncer) once the relay lands in Prompt 08 — e.g. `new PrismaPg({ connectionString, max: N })`.
 */
export function getPrisma(): PrismaClient {
  return (client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }));
}

// AuditEvent/EvidenceRecord/ClaimLine are append-only and ClaimVersion is content-immutable
// (enforced in the database). No auditUpdate/auditDelete is exported; a future recordAudit()
// must expose create + read only.
