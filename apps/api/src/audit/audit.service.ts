import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@tilik/db';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}

// Keep metadata well under the DB's CHECK (octet_length < 1 MiB). A CHECK violation inside a transaction
// would roll the whole mutation back, so we bound it in application code first.
const METADATA_MAX_BYTES = 64 * 1024;

/**
 * Writes append-only AuditEvent rows. tilik_app holds INSERT/SELECT only (no UPDATE/DELETE), so no
 * update/delete helper exists by design. Two paths:
 *   - record()      — a standalone insert, for non-state-persisting actions (login/denials/etc).
 *   - recordInTx()  — MANDATORY for domain mutations: pass the SAME tx client as the state change so the
 *                     audit row commits atomically with it (no gaps). If it throws, the tx rolls back —
 *                     do not swallow it here.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(event: AuditInput) {
    return this.prisma.auditEvent.create({ data: this.bound(event) });
  }

  recordInTx(tx: Prisma.TransactionClient, event: AuditInput) {
    return tx.auditEvent.create({ data: this.bound(event) });
  }

  private bound(event: AuditInput): AuditInput {
    if (event.metadata === undefined) return event;
    const bytes = Buffer.byteLength(JSON.stringify(event.metadata), 'utf8');
    if (bytes <= METADATA_MAX_BYTES) return event;
    this.logger.warn(
      `AuditEvent metadata for '${event.action}' was ${bytes}B (> ${METADATA_MAX_BYTES}B) — dropped`,
    );
    return { ...event, metadata: { truncated: true } };
  }
}
