-- CreateEnum
CREATE TYPE "DetectorType" AS ENUM ('REPEAT_BILLING', 'CLONING', 'PERTENTANGAN_BUKTI');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'PENDING', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('CONFIRMED_FRAUD', 'NOT_FRAUD', 'NEEDS_MORE_INFO');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('MEDICAL_RECORD', 'LAB', 'IMAGING', 'ATTACHMENT', 'CLAIM');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REVIEWER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "ClaimLineType" AS ENUM ('DIAGNOSIS', 'PROCEDURE');

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimVersion" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "claimNo" TEXT NOT NULL,
    "inacbgCode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fingerprint" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersededById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL,
    "claimVersionId" TEXT NOT NULL,
    "type" "ClaimLineType" NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2),

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "objectKey" TEXT,
    "payload" JSONB,
    "contentHash" TEXT NOT NULL,
    "hashAlgo" TEXT NOT NULL DEFAULT 'sha256',
    "fingerprint" TEXT,
    "ingestedBy" TEXT,
    "source" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "claimVersionId" TEXT,
    "relation" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "claimVersionId" TEXT,
    "detector" "DetectorType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "severity" "Severity" NOT NULL,
    "reasons" JSONB NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "caseId" TEXT,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL,
    "acceptedRecords" INTEGER NOT NULL,
    "rejectedRecords" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Episode_patientToken_idx" ON "Episode"("patientToken");

-- CreateIndex
CREATE INDEX "Episode_facilityId_idx" ON "Episode"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimVersion_supersededById_key" ON "ClaimVersion"("supersededById");

-- CreateIndex
CREATE INDEX "ClaimVersion_episodeId_idx" ON "ClaimVersion"("episodeId");

-- CreateIndex
CREATE INDEX "ClaimVersion_contentHash_idx" ON "ClaimVersion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimVersion_claimNo_version_key" ON "ClaimVersion"("claimNo", "version");

-- CreateIndex
CREATE INDEX "ClaimLine_claimVersionId_idx" ON "ClaimLine"("claimVersionId");

-- CreateIndex
CREATE INDEX "ClaimLine_type_code_idx" ON "ClaimLine"("type", "code");

-- CreateIndex
CREATE INDEX "EvidenceRecord_episodeId_idx" ON "EvidenceRecord"("episodeId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_contentHash_idx" ON "EvidenceRecord"("contentHash");

-- CreateIndex
CREATE INDEX "EvidenceLink_evidenceId_idx" ON "EvidenceLink"("evidenceId");

-- CreateIndex
CREATE INDEX "EvidenceLink_claimVersionId_idx" ON "EvidenceLink"("claimVersionId");

-- CreateIndex
CREATE INDEX "Finding_episodeId_idx" ON "Finding"("episodeId");

-- CreateIndex
CREATE INDEX "Finding_claimVersionId_idx" ON "Finding"("claimVersionId");

-- CreateIndex
CREATE INDEX "Finding_caseId_idx" ON "Finding"("caseId");

-- CreateIndex
CREATE INDEX "Finding_detector_idx" ON "Finding"("detector");

-- CreateIndex
CREATE INDEX "Case_status_createdAt_idx" ON "Case"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Decision_caseId_key" ON "Decision"("caseId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetId_idx" ON "AuditEvent"("targetId");

-- CreateIndex
CREATE INDEX "OutboxJob_status_createdAt_idx" ON "OutboxJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_idempotencyKey_key" ON "ImportBatch"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimVersion" ADD CONSTRAINT "ClaimVersion_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ClaimVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimVersionId_fkey" FOREIGN KEY ("claimVersionId") REFERENCES "ClaimVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_claimVersionId_fkey" FOREIGN KEY ("claimVersionId") REFERENCES "ClaimVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_claimVersionId_fkey" FOREIGN KEY ("claimVersionId") REFERENCES "ClaimVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tilik hardening (hand-authored; part of the init migration so it replays into the
-- shadow DB and therefore never registers as drift).
-- ─────────────────────────────────────────────────────────────────────────────

-- Append-only enforcement for the evidence/audit spine (append-only, NOT cryptographic
-- tamper-evidence: a superuser/owner can still DISABLE a trigger; a hash chain is future work).
-- Triggers are ENABLE ALWAYS (below) so they also fire under session_replication_role='replica'.
-- REVOKE is defense-in-depth for non-owner roles.
CREATE OR REPLACE FUNCTION tilik_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ClaimVersion is CONTENT-immutable, not row-immutable: lineage bookkeeping (isCurrent,
-- supersededById, status) must be updatable when a newer version supersedes it. Block DELETE,
-- and reject UPDATEs that touch any immutable (claim-content) column.
CREATE OR REPLACE FUNCTION tilik_claimversion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table ClaimVersion: DELETE not permitted';
  END IF;
  IF ( NEW."id"          IS DISTINCT FROM OLD."id"
    OR NEW."episodeId"   IS DISTINCT FROM OLD."episodeId"
    OR NEW."version"     IS DISTINCT FROM OLD."version"
    OR NEW."claimNo"     IS DISTINCT FROM OLD."claimNo"
    OR NEW."inacbgCode"  IS DISTINCT FROM OLD."inacbgCode"
    OR NEW."amount"      IS DISTINCT FROM OLD."amount"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
    OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" ) THEN
    RAISE EXCEPTION 'ClaimVersion is content-immutable: only isCurrent/supersededById/status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION tilik_block_mutation();
CREATE TRIGGER "AuditEvent_no_truncate" BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION tilik_block_mutation();

CREATE TRIGGER "EvidenceRecord_append_only" BEFORE UPDATE OR DELETE ON "EvidenceRecord"
  FOR EACH ROW EXECUTE FUNCTION tilik_block_mutation();
CREATE TRIGGER "EvidenceRecord_no_truncate" BEFORE TRUNCATE ON "EvidenceRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION tilik_block_mutation();

CREATE TRIGGER "ClaimVersion_append_only" BEFORE UPDATE OR DELETE ON "ClaimVersion"
  FOR EACH ROW EXECUTE FUNCTION tilik_claimversion_guard();
CREATE TRIGGER "ClaimVersion_no_truncate" BEFORE TRUNCATE ON "ClaimVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION tilik_block_mutation();

-- ENABLE ALWAYS: keep the guards active even under logical replication / session_replication_role='replica'.
ALTER TABLE "AuditEvent"     ENABLE ALWAYS TRIGGER "AuditEvent_append_only";
ALTER TABLE "AuditEvent"     ENABLE ALWAYS TRIGGER "AuditEvent_no_truncate";
ALTER TABLE "EvidenceRecord" ENABLE ALWAYS TRIGGER "EvidenceRecord_append_only";
ALTER TABLE "EvidenceRecord" ENABLE ALWAYS TRIGGER "EvidenceRecord_no_truncate";
ALTER TABLE "ClaimVersion"   ENABLE ALWAYS TRIGGER "ClaimVersion_append_only";
ALTER TABLE "ClaimVersion"   ENABLE ALWAYS TRIGGER "ClaimVersion_no_truncate";

-- Defense-in-depth for non-owner roles (the app/worker role added in Prompt 03). INSERT/SELECT stay granted.
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent", "EvidenceRecord" FROM PUBLIC;
-- ClaimVersion keeps UPDATE (lineage columns are mutable; tilik_claimversion_guard restricts which columns change).
REVOKE DELETE, TRUNCATE ON "ClaimVersion" FROM PUBLIC;

-- Self-pruning FIFO index for the transactional-outbox relay (SELECT ... FOR UPDATE SKIP LOCKED).
CREATE INDEX "OutboxJob_pending_fifo_idx" ON "OutboxJob" ("createdAt") WHERE "status" = 'PENDING';

-- Exactly one current version per claimNo (partial unique; replaces the non-unique (claimNo, isCurrent) index).
CREATE UNIQUE INDEX "ClaimVersion_one_current_idx" ON "ClaimVersion" ("claimNo") WHERE "isCurrent";

-- Data-quality CHECK constraints.
ALTER TABLE "ClaimVersion"   ADD CONSTRAINT "ClaimVersion_amount_nonneg"   CHECK ("amount" >= 0);
ALTER TABLE "ClaimVersion"   ADD CONSTRAINT "ClaimVersion_version_min"     CHECK ("version" >= 1);
ALTER TABLE "ClaimLine"      ADD CONSTRAINT "ClaimLine_amount_nonneg"      CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "Episode"        ADD CONSTRAINT "Episode_dates_order"          CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_has_content"   CHECK ("objectKey" IS NOT NULL OR "payload" IS NOT NULL);
ALTER TABLE "EvidenceLink"   ADD CONSTRAINT "EvidenceLink_relation_values" CHECK ("relation" IN ('mendukung', 'bertentangan', 'sumber'));
