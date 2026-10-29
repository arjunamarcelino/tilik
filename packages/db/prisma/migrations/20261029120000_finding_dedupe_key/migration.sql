-- Finding idempotency key: add "dedupeKey" + a unique (episodeId, detector, dedupeKey).
--
-- WHY: Finding has no natural key — Prisma mints "id" as a random cuid/uuid client-side — so a worker
-- re-run, a re-seed, or the (Prompt 08+) stale-lock reaper requeuing a job and a peer re-processing it would
-- insert DUPLICATE findings. A deterministic per-finding "dedupeKey" (sha256 hex the detector computes) plus
-- this unique constraint lets insert_findings use ON CONFLICT DO NOTHING, so re-detection is idempotent.
-- Lease-fencing alone can't cover this: a fresh lease legitimately re-inserts keyless findings.
--
-- SHAPE: nullable → backfill from "id" → SET NOT NULL, THEN the unique index. This is safe on a non-empty
-- Finding table (any env that ran an early detector build): a bare `ADD COLUMN ... NOT NULL` with no default
-- fails where rows exist. Backfilling from "id" (the PK) both satisfies NOT NULL AND guarantees every
-- (episodeId, detector, "id") triple is globally unique, so the unique-index build cannot collide on the
-- pre-existing rows. Authored by hand (not `migrate dev`) only because the required-column add needs the
-- backfill step; the @@unique itself is native and lives in schema.prisma.
--
-- All three key columns are NOT NULL ("episodeId"/"detector" already; "dedupeKey" after this), so the index
-- is not subject to Postgres NULLS DISTINCT — NULL keys would otherwise each count as unique and defeat the
-- dedupe. Finding is NOT append-only (tilik_app keeps full CRUD; it is absent from grant-app.sql's REVOKEs),
-- so no grant change is needed and the new column inherits the table-level INSERT.

ALTER TABLE "Finding" ADD COLUMN "dedupeKey" TEXT;
UPDATE "Finding" SET "dedupeKey" = "id" WHERE "dedupeKey" IS NULL;
ALTER TABLE "Finding" ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE UNIQUE INDEX "Finding_episodeId_detector_dedupeKey_key" ON "Finding"("episodeId", "detector", "dedupeKey");
