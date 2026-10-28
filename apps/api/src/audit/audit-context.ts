import type { Request } from 'express';

const AUDITED_IN_TX = Symbol('tilik.auditedInTx');

type Tracked = Request & { [AUDITED_IN_TX]?: true };

/**
 * Mark the current request as having already recorded its audit row inside a transaction (via
 * AuditService.recordInTx). The global AuditInterceptor checks this and skips its own write, so a handler
 * that correctly audits in-tx cannot be double-audited even if @Audit is mistakenly left on the route —
 * making the "exactly one AuditEvent" invariant mechanical rather than convention-only.
 */
export function markAuditedInTx(req: Request): void {
  (req as Tracked)[AUDITED_IN_TX] = true;
}

export function wasAuditedInTx(req: Request): boolean {
  return (req as Tracked)[AUDITED_IN_TX] === true;
}
