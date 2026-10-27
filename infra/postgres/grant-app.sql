-- Grant the non-owner app role (tilik_app) CRUD on the schema Prisma Migrate created.
--
-- Run as the OWNER, AFTER every migration:  pnpm --filter @tilik/db db:grant
-- Idempotent and order-independent (re-runnable any time).
--
-- WHY this shape (not ALTER DEFAULT PRIVILEGES, not a blanket grant):
--   The append-only guarantee (AuditEvent / EvidenceRecord / ClaimLine immutable; ClaimVersion
--   content-immutable) must bind the NON-OWNER. A blanket UPDATE/DELETE grant would hand tilik_app
--   exactly the write-back the spine must withhold, collapsing the model to trigger-only. So we
--   grant CRUD broadly, then ROLE-TARGETED REVOKE the mutating privileges on the append-only tables.
--   (A REVOKE ... FROM PUBLIC would be a no-op: default tables grant nothing to PUBLIC.)
--
-- Keep the REVOKE list below in sync with the init migration's append-only tables.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tilik_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tilik_app; -- Prisma autoincrement => SERIAL

-- Preserve append-only for the non-owner: strip write-back on the immutable spine.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent", "EvidenceRecord", "ClaimLine" FROM tilik_app;
REVOKE DELETE, TRUNCATE ON "ClaimVersion" FROM tilik_app;
