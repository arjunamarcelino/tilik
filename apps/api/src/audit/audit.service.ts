import { Injectable } from '@nestjs/common';
import { Prisma, type AuditEvent } from '@tilik/db';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes append-only AuditEvent rows. tilik_app holds INSERT/SELECT only (no UPDATE/DELETE), so no
 * update/delete helper exists by design. Two paths:
 *   - record()      — a standalone insert, for non-state-persisting actions (login/denials/etc).
 *   - recordInTx()  — MANDATORY for domain mutations: pass the SAME tx client as the state change so the
 *                     audit row commits atomically with it (no gaps). If it throws, the tx rolls back —
 *                     do not swallow it here. Such a handler must NOT also carry @Audit; calling
 *                     markAuditedInTx(req) (audit-context.ts) makes that safe — the interceptor then skips.
 *
 * TODO(Prompt 06): re-introduce an application-level metadata size/field bound BEFORE insert once a route
 * writes caller-supplied metadata — the DB CHECK (octet_length < 1 MiB) is only a last-resort backstop and
 * a violation inside a transaction would roll back the surrounding mutation.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(event: AuditInput): Promise<AuditEvent> {
    return this.prisma.auditEvent.create({ data: event });
  }

  recordInTx(tx: Prisma.TransactionClient, event: AuditInput): Promise<AuditEvent> {
    return tx.auditEvent.create({ data: event });
  }
}
