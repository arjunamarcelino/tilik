import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMeta {
  action: string;
  targetType: string;
}

/**
 * Declare a route auditable by the global AuditInterceptor.
 *
 * Contract (the interceptor enforces it and warns on misuse):
 *   - The route must be AUTHENTICATED (an actor is read from the JWT) and STATE-CHANGING
 *     (POST/PUT/PATCH/DELETE). @Audit on a public or GET route is skipped with a warning, not recorded.
 *   - Use it only for actions whose audit row is the SOLE durable record (no domain state is persisted).
 *   - A handler that mutates domain state must instead call AuditService.recordInTx() inside its
 *     transaction and MUST NOT also carry @Audit — using both writes two AuditEvents (see AuditService).
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);
