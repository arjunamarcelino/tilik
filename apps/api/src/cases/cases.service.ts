import { Injectable } from '@nestjs/common';
// Prisma enum VALUES (persistence edge) — distinct nominal type from @tilik/shared's enums, but identical
// string members, so the zero-filled records are structurally the shared `CaseStats` shape.
import { CaseStatus, Severity } from '@tilik/db';
import type { CaseStats } from '@tilik/shared/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard counts. ONE read-only grouped query over the non-owner client — so it respects the two-writer
   * Case contract and needs no migration. A single `groupBy` is its own consistent snapshot by construction,
   * so no `$transaction`/RepeatableRead is needed to make the sub-counts reconcile (review P2-2). `byStatus`
   * is over all cases (sum across severities); `bySeverity` is over OPEN cases only (the triage figure).
   */
  async stats(): Promise<CaseStats> {
    const rows = await this.prisma.case.groupBy({
      by: ['status', 'severity'],
      _count: { _all: true },
    });

    // Dense, exhaustively-keyed zero-fills — cast-free, so omitting/renaming an enum member is a compile
    // error (review P3-10). Prisma enum values are identical string members to @tilik/shared's, so these
    // are structurally the shared `CaseStats` records.
    const byStatus: Record<CaseStatus, number> = {
      [CaseStatus.OPEN]: 0,
      [CaseStatus.IN_REVIEW]: 0,
      [CaseStatus.PENDING]: 0,
      [CaseStatus.ESCALATED]: 0,
      [CaseStatus.CLOSED]: 0,
    };
    const bySeverity: Record<Severity, number> = {
      [Severity.LOW]: 0,
      [Severity.MEDIUM]: 0,
      [Severity.HIGH]: 0,
    };

    let total = 0;
    for (const row of rows) {
      const n = row._count._all;
      total += n;
      byStatus[row.status] += n;
      if (row.status === CaseStatus.OPEN) bySeverity[row.severity] += n;
    }

    return { total, open: byStatus[CaseStatus.OPEN], byStatus, bySeverity };
  }
}
