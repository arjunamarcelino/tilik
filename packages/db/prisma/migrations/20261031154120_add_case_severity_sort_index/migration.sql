-- CreateIndex
CREATE INDEX "Case_severity_createdAt_id_idx" ON "Case"("severity" DESC, "createdAt" DESC, "id" DESC);
