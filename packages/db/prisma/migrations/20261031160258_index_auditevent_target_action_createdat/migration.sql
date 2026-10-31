-- DropIndex
DROP INDEX "AuditEvent_targetId_idx";

-- CreateIndex
CREATE INDEX "AuditEvent_targetId_action_createdAt_idx" ON "AuditEvent"("targetId", "action", "createdAt" DESC);
