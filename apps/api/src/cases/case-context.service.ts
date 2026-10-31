import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EvidenceLink, type EvidenceRecord, type Finding } from '@tilik/db';
import { PrismaService } from '../prisma/prisma.service';

// The case scalars + folded episode identity + 0..1 decision that the detail read needs. The summary path
// uses only `episodeId` from this (and ignores the identity fields — they never reach the prompt).
const CASE_CONTEXT_SELECT = {
  id: true,
  episodeId: true,
  status: true,
  severity: true,
  assignedTo: true,
  summary: true,
  createdAt: true,
  updatedAt: true,
  episode: { select: { id: true, patientToken: true, facilityId: true, importBatchId: true } },
  decision: { select: { verdict: true, rationale: true, decidedAt: true } },
} satisfies Prisma.CaseSelect;

export type CaseContextBase = Prisma.CaseGetPayload<{ select: typeof CASE_CONTEXT_SELECT }>;
export type ClaimVersionWithLines = Prisma.ClaimVersionGetPayload<{ include: { lines: true } }>;

/** The raw read surface of one case — exactly the rows both the detail read and the summary gather ground on. */
export interface CaseContext {
  base: CaseContextBase;
  findings: Finding[];
  claimVersions: ClaimVersionWithLines[];
  evidence: EvidenceRecord[];
  links: EvidenceLink[];
}

/**
 * Single source of truth for gathering a case's evidence surface (Prompt 11/13). SIDE-EFFECT-FREE and
 * read-only: no evidence-integrity verification (no MinIO fetch), no VIEW_CASE audit, no DTO mapping — those
 * are layered by each caller. Extracted so the detail read and the Claude summary are grounded in the
 * *same* definition of "what is in a case": if the gather shape changes, both move together and the summary
 * can't silently diverge from what the reviewer sees on screen.
 */
@Injectable()
export class CaseContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Gather a case's rows, or throw 404. Reads only — the two-writer Case contract holds. */
  async gather(id: string): Promise<CaseContext> {
    const base = await this.prisma.case.findUnique({ where: { id }, select: CASE_CONTEXT_SELECT });
    if (!base) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });

    const episodeId = base.episode.id;
    const [findings, claimVersions, evidence, links] = await Promise.all([
      this.prisma.finding.findMany({ where: { caseId: id } }),
      this.prisma.claimVersion.findMany({
        where: { episodeId },
        include: { lines: { orderBy: { sequence: 'asc' } } },
        orderBy: [{ claimNo: 'asc' }, { version: 'asc' }],
      }),
      this.prisma.evidenceRecord.findMany({ where: { episodeId }, orderBy: { capturedAt: 'asc' } }),
      // Every link has an evidenceId; evidence belongs to one episode, so this scopes to the case's evidence.
      this.prisma.evidenceLink.findMany({ where: { evidence: { episodeId } } }),
    ]);

    return { base, findings, claimVersions, evidence, links };
  }
}
