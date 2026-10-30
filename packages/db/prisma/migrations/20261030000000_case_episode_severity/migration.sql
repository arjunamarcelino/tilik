-- Case aggregation (Prompt 09): tie a Case to exactly one Episode + carry a derived triage severity.
--
-- WHY: the worker aggregates an episode's Findings into one Case. "Exactly one Case per flagged episode"
-- must survive re-detection (worker re-run / reaper requeue), so the find-or-create needs a natural key —
-- "episodeId" + a UNIQUE, letting upsert_case use ON CONFLICT ("episodeId"). "severity" is the sortable
-- triage column the review surface (Prompt 11) reads; the worker derives it = max over the Case's findings.
--
-- SHAPE: a bare `ADD COLUMN ... NOT NULL` with no default (not the dedupeKey nullable→backfill→SET NOT NULL
-- shape). That shape worked for Finding because "dedupeKey" had a backfill source ("id"); Case.episodeId has
-- NONE — a pre-existing Case row is genuinely unresolvable automatically. So emptiness is a PRECONDITION:
-- Case has no writer before Prompt 09 (Prompt 06 import writes episodes/claims/evidence/staging/outbox/audit;
-- Prompt 08 writes Finding with caseId left NULL), so the table is empty in every environment. The guard
-- below turns a violated assumption into a readable error instead of a cryptic NOT NULL failure.
--
-- Case is MUTABLE (tilik_app keeps full CRUD; absent from grant-app.sql's REVOKEs), so no grant change is
-- needed and the new columns inherit the table-level INSERT/UPDATE. Authored by hand (not `migrate dev`)
-- only because of the guard + required-column add; the @unique/relation live in schema.prisma.

DO $$ BEGIN
  IF (SELECT count(*) FROM "Case") > 0 THEN
    RAISE EXCEPTION 'Case is non-empty: "episodeId" has no backfill source (not derivable like Finding.dedupeKey<-id). Resolve manually before migrating.';
  END IF;
END $$;

ALTER TABLE "Case" ADD COLUMN "episodeId" TEXT NOT NULL;
ALTER TABLE "Case" ADD COLUMN "severity" "Severity" NOT NULL;

ALTER TABLE "Case" ADD CONSTRAINT "Case_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Case_episodeId_key" ON "Case"("episodeId");
