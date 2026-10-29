// String constants shared across the API and (conceptually) the Python detector.
//
// IMPORTANT: this module is exported ONLY via the "@tilik/shared/constants" subpath — it is deliberately
// NOT re-exported from src/index.ts. The enum-parity guard (packages/db/scripts/check-enum-parity.ts)
// scans the root barrel via `import * as Shared` and treats every `Record<string, string>` export as an
// enum needing a Prisma twin. An `as const` string object IS structurally `Record<string, string>`, so
// re-exporting these from the root would fail `pnpm typecheck`. Keep them behind the subpath.
//
// `OutboxJob.type` and `AuditEvent.action` are plain Postgres `String` columns (not Prisma enums), so
// these constants are their single source of truth without any schema mirror.

/** OutboxJob.type values. */
export const OUTBOX_JOB_TYPE = {
  DETECT_EPISODE: 'DETECT_EPISODE',
} as const;
export type OutboxJobType = (typeof OUTBOX_JOB_TYPE)[keyof typeof OUTBOX_JOB_TYPE];

/**
 * AuditEvent.action values that cross a service boundary.
 *
 * Convention: only actions that cross a service boundary live as shared constants. API-only actions
 * (AUTH_LOGIN_FAILED, USER_LOGIN, ACCESS_DENIED) stay inline string literals at their call sites — they need
 * no shared contract. IMPORT_STARTED/IMPORT are written by the import pipeline; DETECT is written by the
 * Python detector and read by the case/audit UI (Prompt 11), so it is pinned both sides via
 * test-vectors/audit-contract.json (TS: apps/api test:contract; Python: tests/test_outbox_contract.py).
 */
export const AUDIT_ACTION = {
  IMPORT_STARTED: 'IMPORT_STARTED', // durable at key-claim: who/when, before any domain state lands
  IMPORT: 'IMPORT', // terminal, at finalize: the single per-batch audit row
  DETECT: 'DETECT', // detector worker, per processed episode: a summary of what detection produced
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
