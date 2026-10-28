-- Review follow-up (PR #5, findings P2-6 / P2-7): make the tamper-evidence / provenance columns
-- DB-enforced, not merely app-discipline. These are hand-authored (Prisma does not model triggers);
-- there is NO schema.prisma change, so this migration is custom SQL only.
--
--   P2-6: StagingRecord.raw / rawHash are the "exactly what was submitted" record. tilik_app keeps
--         UPDATE on the table (accepted / rejectionReason are legitimately mutable), so a column-aware
--         guard pins raw/rawHash while leaving the status columns writable.
--   P2-7: Episode.importBatchId is provenance. Episode is otherwise mutable (updatedAt), and tilik_app
--         keeps UPDATE, so a column-aware guard pins importBatchId (mirrors tilik_claimversion_guard).
--
-- Both triggers are ENABLE ALWAYS so they bind under logical replication / session_replication_role='replica'.
-- DELETE/TRUNCATE on these tables is already withheld from tilik_app in infra/postgres/grant-app.sql.

-- StagingRecord: block changes to the immutable submission columns (raw, rawHash); DELETE handled by grant.
CREATE OR REPLACE FUNCTION tilik_stagingrecord_guard() RETURNS trigger AS $$
BEGIN
  IF ( NEW."raw"     IS DISTINCT FROM OLD."raw"
    OR NEW."rawHash" IS DISTINCT FROM OLD."rawHash"
    OR NEW."id"           IS DISTINCT FROM OLD."id"
    OR NEW."importBatchId" IS DISTINCT FROM OLD."importBatchId"
    OR NEW."recordType"  IS DISTINCT FROM OLD."recordType"
    OR NEW."ref"         IS DISTINCT FROM OLD."ref" ) THEN
    RAISE EXCEPTION 'StagingRecord submission columns are immutable: only accepted/rejectionReason may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StagingRecord_immutable_submission" BEFORE UPDATE ON "StagingRecord"
  FOR EACH ROW EXECUTE FUNCTION tilik_stagingrecord_guard();
ALTER TABLE "StagingRecord" ENABLE ALWAYS TRIGGER "StagingRecord_immutable_submission";

-- Episode: pin provenance (importBatchId) while leaving every other column mutable (updatedAt etc.).
CREATE OR REPLACE FUNCTION tilik_episode_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."importBatchId" IS DISTINCT FROM OLD."importBatchId" THEN
    RAISE EXCEPTION 'Episode.importBatchId is immutable provenance and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Episode_immutable_provenance" BEFORE UPDATE ON "Episode"
  FOR EACH ROW EXECUTE FUNCTION tilik_episode_guard();
ALTER TABLE "Episode" ENABLE ALWAYS TRIGGER "Episode_immutable_provenance";
