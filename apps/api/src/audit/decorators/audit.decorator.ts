import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMeta {
  action: string;
  targetType: string;
}

/**
 * Declare a route auditable by the global AuditInterceptor. Use ONLY for non-state-persisting actions
 * (login-class, reads/exports, denials) where the audit row is the sole durable record. Any handler that
 * mutates domain state must instead record via AuditService.recordInTx() inside its own transaction, and
 * must NOT carry @Audit — using both would write two AuditEvents and break the "exactly one" invariant.
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);
