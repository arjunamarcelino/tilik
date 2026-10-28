import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../common/types/auth';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditMeta } from './decorators/audit.decorator';

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractId(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'id' in body) {
    return asString((body as { id: unknown }).id);
  }
  return undefined;
}

/**
 * Writes an AuditEvent after a successful, state-changing, @Audit-annotated request. concatMap awaits the
 * write before the response flushes (so "exactly one AuditEvent" is deterministic), but a failed write is
 * logged and swallowed — it must never turn a 2xx into a 500. Because it runs only on the success stream,
 * failed requests are not audited here. Domain mutations use AuditService.recordInTx() instead (see @Audit).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!meta || !STATE_CHANGING.includes(req.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        const targetId =
          extractId(body) ?? asString(req.params.id) ?? `route:${ctx.getHandler().name}`;
        try {
          await this.audit.record({
            actor: req.user.userId,
            action: meta.action,
            targetType: meta.targetType,
            targetId,
            metadata: { outcome: 'SUCCESS' },
          });
        } catch (err) {
          this.logger.error(
            `audit write failed for '${meta.action}' (response unaffected): ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
        return body;
      }),
    );
  }
}
