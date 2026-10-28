import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@tilik/shared';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';

/**
 * Verification stub — registered ONLY when NODE_ENV === 'development' (see app.module.ts) and deleted
 * when Prompt 06's first real mutation lands. It exercises the @Audit interceptor end-to-end: a
 * JWT-protected, state-changing call that writes exactly one AuditEvent with the actor taken from the JWT.
 */
@Controller('dev')
export class DevController {
  @Roles(Role.REVIEWER)
  @Audit({ action: 'DEV_AUDIT_CHECK', targetType: 'Dev' })
  @HttpCode(HttpStatus.OK)
  @Post('audit-check')
  check(@CurrentUser() user: AuthenticatedUser): { id: string; ok: boolean } {
    return { id: `dev-${user.userId}`, ok: true };
  }
}
