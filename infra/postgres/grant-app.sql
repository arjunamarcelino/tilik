-- Grant the non-owner app role (tilik_app) CRUD on the schema Prisma Migrate created.
--
-- Run as the OWNER, AFTER every migration:  pnpm --filter @tilik/db db:grant
-- Idempotent; re-runnable after any migration (the REVOKEs reference tables that must already exist).
--
-- WHY this shape (not ALTER DEFAULT PRIVILEGES, not a blanket grant):
--   The append-only guarantee (AuditEvent / EvidenceRecord / ClaimLine immutable; ClaimVersion
--   content-immutable) must bind the NON-OWNER. A blanket UPDATE/DELETE grant would hand tilik_app
--   exactly the write-back the spine must withhold, collapsing the model to trigger-only. So we
--   grant CRUD broadly, then ROLE-TARGETED REVOKE the mutating privileges on the append-only tables.
--   (A REVOKE ... FROM PUBLIC would be a no-op: default tables grant nothing to PUBLIC.)
--
-- Keep the REVOKE list below in sync with the init migration's append-only tables.

-- Schema USAGE is a prerequisite for any table access. The Compose init normally grants it, but
-- `prisma migrate reset` DROPs and recreates schema public (losing it), after which the app hits
-- "permission denied for schema public". Granting it here makes db:grant self-sufficient after a full
-- reset too. (USAGE only — never CREATE: the non-owner must not alter the schema.)
GRANT USAGE ON SCHEMA public TO tilik_app;

-- Version-independent DDL lock (review P3-8): on PG ≤14 schema public grants CREATE to PUBLIC by default,
-- which tilik_app would inherit regardless of the init's role-targeted REVOKE; and a `migrate reset`
-- recreates public with cluster defaults. Revoking from PUBLIC here (idempotent, reset-safe) ensures the
-- non-owner can never create objects to shadow the append-only triggers, on any PG version. (No-op on the
-- pinned PG16, where PUBLIC gets no CREATE by default.)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM tilik_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tilik_app;
-- No sequences today: every PK is an app-generated TEXT id (cuid/uuid), not SERIAL. Kept so a future
-- autoincrement column grants correctly without editing this file; harmless no-op until then.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tilik_app;

-- Preserve append-only for the non-owner: strip write-back on the immutable spine. TRUNCATE is never
-- granted above (not grantable via ON ALL TABLES), so revoking it is defense-in-depth, not load-bearing
-- — the real TRUNCATE block is the statement-level triggers in the init migration.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent", "EvidenceRecord", "ClaimLine" FROM tilik_app;
REVOKE DELETE, TRUNCATE ON "ClaimVersion" FROM tilik_app;

-- Prompt 06: StagingRecord (raw "mentah") and ImportBatch are MUTABLE control tables (the app sets
-- accepted/rejectionReason, status/counts/completedAt) — so tilik_app keeps SELECT/INSERT/UPDATE — but
-- they are the submission + provenance anchors, so DELETE/TRUNCATE are withheld: the app must never be
-- able to erase what was submitted or which batch minted a row. (No append-only trigger on them.)
REVOKE DELETE, TRUNCATE ON "StagingRecord", "ImportBatch" FROM tilik_app;

-- Prompt 12: Decision is a decided-ONCE, immutable record (one per Case, enforced by the unique caseId).
-- The reviewer's verdict must be as tamper-resistant to the app as an audit row, so tilik_app keeps
-- SELECT/INSERT (the decide path inserts once; detail reads it) but is REVOKEd UPDATE/DELETE/TRUNCATE. This
-- is grant-level immutability for the non-owner (like StagingRecord/ImportBatch) — not owner-proof: there is
-- no ENABLE ALWAYS trigger, so this is NOT the full append-only spine (AuditEvent/EvidenceRecord/ClaimLine).
REVOKE UPDATE, DELETE, TRUNCATE ON "Decision" FROM tilik_app;
