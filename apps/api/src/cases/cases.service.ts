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
   * Dashboard counts. Strictly read-only (two groupBy, no write) over the non-owner client, so it respects
   * the two-writer Case contract and needs no migration. Both reads run under ONE RepeatableRead snapshot so
   * the sub-counts reconcile even while the detector commits Case upserts concurrently (MVCC-only, no row
   * locks → cannot contend with the worker). `byStatus` is over all cases; `bySeverity` over OPEN cases only.
   */
  async stats(): Promise<CaseStats> {
    return this.prisma.$transaction(
      async (tx) => {
        const [byStatusRows, bySeverityRows] = await Promise.all([
          tx.case.groupBy({ by: ['status'], _count: { _all: true } }),
          tx.case.groupBy({
            by: ['severity'],
            where: { status: CaseStatus.OPEN },
            _count: { _all: true },
          }),
        ]);

        const byStatus = Object.fromEntries(Object.values(CaseStatus).map((s) => [s, 0])) as Record<
          CaseStatus,
          number
        >;
        for (const row of byStatusRows) byStatus[row.status] = row._count._all;

        const bySeverity = Object.fromEntries(Object.values(Severity).map((s) => [s, 0])) as Record<
          Severity,
          number
        >;
        for (const row of bySeverityRows) bySeverity[row.severity] = row._count._all;

        // total/open derived in JS — no extra count() query.
        const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
        return { total, open: byStatus.OPEN, byStatus, bySeverity };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
