import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

// Single import point for the API: PrismaClient, the Prisma namespace (Decimal, …),
// every model type, and every generated enum.
export * from './generated/prisma/client';

declare global {
  var __tilikPrisma: PrismaClient | undefined;
}

// Prisma 7 requires a driver adapter (or an Accelerate URL). The URL is read at runtime from
// the environment; the connection is lazy, so importing @tilik/db never touches the database
// (keeps `pnpm -r build` / `prisma generate` database-free).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Hot-reload-safe singleton. NestJS (Prompt 04) wraps the class in a PrismaService; this
// instance is for scripts and seeds.
export const prisma: PrismaClient = globalThis.__tilikPrisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') globalThis.__tilikPrisma = prisma;

// AuditEvent, EvidenceRecord, and ClaimVersion are append-only (enforced in the database).
// No auditUpdate/auditDelete is exported; a future recordAudit() must expose create + read only.
