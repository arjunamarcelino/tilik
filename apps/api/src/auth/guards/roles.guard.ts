import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@tilik/shared';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedRequest } from '../../common/types/auth';
import { ROLES_KEY } from '../decorators/roles.decorator';

// ADMIN ⊇ REVIEWER: an ADMIN satisfies any REVIEWER-gated route without double-tagging. Exhaustively
// keyed over the finite Role union, so the lookup is never `undefined` (no `?? []` needed).
const HIERARCHY: Record<Role, readonly Role[]> = {
  [Role.ADMIN]: [Role.ADMIN, Role.REVIEWER],
  [Role.REVIEWER]: [Role.REVIEWER],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true; // no @Roles → an authenticated user is enough

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = HIERARCHY[user.role];
    const allowed = required.some((role) => granted.includes(role));

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
