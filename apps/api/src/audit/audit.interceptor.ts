import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import type { AuthenticatedUser } from '../common/types/auth';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditMeta } from './decorators/audit.decorator';

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Typed honestly: the interceptor can run on a @Public route, so user may be absent at runtime.
type MaybeAuthedRequest = Request & { user?: AuthenticatedUser };

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
 * Records an AuditEvent after a successful @Audit-annotated request. Scope (matches @Audit): an
 * AUTHENTICATED, state-changing action whose audit row is its only durable record. Domain state mutations
 * must use AuditService.recordInTx() inside their transaction instead (atomic, no gaps).
 *
 * The write is awaited (so "exactly one AuditEvent" is deterministic) but a failure is logged and swallowed
 * — it never turns a 2xx into a 500. @Audit used outside its contract (a non-state-changing method, or an
 * unauthenticated route with no actor) is logged as a misuse warning and skipped, rather than silently
 * recording nothing or throwing a swallowed TypeError.
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
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest<MaybeAuthedRequest>();
    if (!STATE_CHANGING.includes(req.method)) {
      this.logger.warn(
        `@Audit on a non-state-changing ${req.method} route ('${meta.action}') is ignored — the ` +
          'interceptor only records POST/PUT/PATCH/DELETE. Record reads explicitly instead.',
      );
      return next.handle();
    }

    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        const actor = req.user?.userId;
        if (!actor) {
          this.logger.warn(
            `@Audit on an unauthenticated route ('${meta.action}') has no actor to record — skipped. ` +
              'Record it explicitly with a known actor instead.',
          );
          return body;
        }
        const targetId =
          extractId(body) ?? asString(req.params.id) ?? `route:${ctx.getHandler().name}`;
        try {
          await this.audit.record({
            actor,
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
