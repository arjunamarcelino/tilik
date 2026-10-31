import { Controller, Get } from '@nestjs/common';
import { Role } from '@tilik/shared';
import type { CaseStats } from '@tilik/shared/contracts';
import { Roles } from '../auth/decorators/roles.decorator';
import { CasesService } from './cases.service';

/**
 * Read-only case endpoints for the portal. Prompt 10 ships only aggregate stats; the full list/detail and
 * reviewer-owned writes (status/assignedTo/summary/Decision) land in Prompt 11 on this same module — which
 * must never write the detector-owned `severity`/existence (two-writer Case contract).
 *
 * No @Audit: these are reads (audit is for state-changing actions). stats is aggregate (no specific case),
 * so it should never audit even later — per-case VIEW_CASE auditing is a Prompt-11 concern.
 */
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  // ADMIN ⊇ REVIEWER in RolesGuard, so REVIEWER tags the lowest sufficient role (ADMIN passes too).
  @Get('stats')
  @Roles(Role.REVIEWER)
  stats(): Promise<CaseStats> {
    return this.cases.stats();
  }
}
