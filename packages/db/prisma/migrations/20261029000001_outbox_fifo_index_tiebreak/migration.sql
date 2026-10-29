-- Outbox FIFO claim index: add the "id" tiebreaker to the partial index.
--
-- The detector worker (Prompt 07) claims the oldest PENDING DETECT_EPISODE job with
--   ... WHERE "status" = 'PENDING' ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
-- The original index (init migration) was keyed on ("createdAt") only. Because a whole import batch is one
-- transaction and Postgres now() is transaction-stable, every job from a batch shares an identical
-- "createdAt" -- so the "id" tiebreaker is the common case, and ("createdAt") alone forces an incremental
-- sort of the whole same-"createdAt" group on every poll (O(K^2) across a drain). Keying the partial index
-- on ("createdAt", "id") serves the ORDER BY directly, with no sort node.
--
-- Partial indexes are not representable in schema.prisma, so (like the original) this is hand-authored SQL;
-- there is no corresponding @@index in the schema and thus no drift for `prisma migrate` to detect.

DROP INDEX "OutboxJob_pending_fifo_idx";
CREATE INDEX "OutboxJob_pending_fifo_idx" ON "OutboxJob" ("createdAt", "id") WHERE "status" = 'PENDING';
