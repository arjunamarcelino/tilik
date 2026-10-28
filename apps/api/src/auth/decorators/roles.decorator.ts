import { SetMetadata } from '@nestjs/common';
import { Role } from '@tilik/shared';

export const ROLES_KEY = 'roles';

/** Require one of these domain roles. `@Roles(Role.REVIEWER)` means "reviewer-level or above" (ADMIN ⊇ REVIEWER). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
