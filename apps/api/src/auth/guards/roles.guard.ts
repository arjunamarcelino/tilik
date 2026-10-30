import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, roleSatisfies } from '@tilik/shared';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedRequest } from '../../common/types/auth';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true; // no @Roles → an authenticated user is enough

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // ADMIN ⊇ REVIEWER via the shared hierarchy (single source of truth in @tilik/shared).
    const allowed = required.some((role) => roleSatisfies(user.role, role));

    if (!allowed) {
      // Best-effort: record the denial (high-signal for a fraud trail) without blocking the 403.
      void this.audit
        .record({
          actor: user.userId,
          action: 'ACCESS_DENIED',
          targetType: 'Route',
          targetId: context.getHandler().name,
          metadata: { outcome: 'DENIED', required },
        })
        .catch(() => undefined);
    }
    return allowed;
  }
}
