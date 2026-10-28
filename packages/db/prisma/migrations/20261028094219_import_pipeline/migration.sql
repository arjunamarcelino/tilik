-- Prompt 06 — Import pipeline: provenance FKs, durable staging, per-actor idempotency.
--
-- The ALTER/CREATE/DROP block below is Prisma-generated (prisma migrate diff). The trigger
-- replacement at the bottom is HAND-AUTHORED: Prisma does not manage triggers/functions, so the
-- new ClaimVersion.importBatchId column would otherwise fall outside the content-immutability guard
-- and the app role (which retains UPDATE on ClaimVersion for lineage writes) could rewrite a claim's
-- provenance. Adding it to the guard's immutable-column set closes that hole.
--
-- Safety: ImportBatch is empty at this migration (new feature, no writers yet), so the NOT NULL
-- adds (uploadedBy, updatedAt) apply without a backfill. DELETE/TRUNCATE on StagingRecord and
-- ImportBatch are withheld from tilik_app in infra/postgres/grant-app.sql (run via db:grant).

-- DropIndex
DROP INDEX "ImportBatch_idempotencyKey_key";

-- AlterTable
ALTER TABLE "ClaimVersion" ADD COLUMN     "importBatchId" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "importBatchId" TEXT;

-- AlterTable
ALTER TABLE "EvidenceRecord" ADD COLUMN     "importBatchId" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "error" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "uploadedBy" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "StagingRecord" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "rawHash" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagingRecord_importBatchId_idx" ON "StagingRecord"("importBatchId");

-- CreateIndex
CREATE INDEX "StagingRecord_importBatchId_recordType_idx" ON "StagingRecord"("importBatchId", "recordType");

-- CreateIndex
CREATE INDEX "ClaimVersion_importBatchId_idx" ON "ClaimVersion"("importBatchId");

-- CreateIndex
CREATE INDEX "Episode_importBatchId_idx" ON "Episode"("importBatchId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_importBatchId_idx" ON "EvidenceRecord"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_uploadedBy_idempotencyKey_key" ON "ImportBatch"("uploadedBy", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagingRecord" ADD CONSTRAINT "StagingRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HAND-AUTHORED (not emitted by Prisma): extend the ClaimVersion content-immutability guard to also
-- reject changes to importBatchId. CREATE OR REPLACE keeps the existing ENABLE ALWAYS trigger binding
-- (ClaimVersion_append_only) — no trigger drop/recreate needed.
CREATE OR REPLACE FUNCTION tilik_claimversion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table ClaimVersion: DELETE not permitted';
  END IF;
  IF ( NEW."id"            IS DISTINCT FROM OLD."id"
    OR NEW."episodeId"     IS DISTINCT FROM OLD."episodeId"
    OR NEW."version"       IS DISTINCT FROM OLD."version"
    OR NEW."claimNo"       IS DISTINCT FROM OLD."claimNo"
    OR NEW."inacbgCode"    IS DISTINCT FROM OLD."inacbgCode"
    OR NEW."amount"        IS DISTINCT FROM OLD."amount"
    OR NEW."contentHash"   IS DISTINCT FROM OLD."contentHash"
    OR NEW."fingerprint"   IS DISTINCT FROM OLD."fingerprint"
    OR NEW."submittedAt"   IS DISTINCT FROM OLD."submittedAt"
    OR NEW."importBatchId" IS DISTINCT FROM OLD."importBatchId" ) THEN
    RAISE EXCEPTION 'ClaimVersion is content-immutable: only isCurrent/supersededById/status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
