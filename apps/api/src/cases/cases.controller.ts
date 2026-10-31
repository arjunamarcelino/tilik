import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@tilik/shared';
import type { CaseDetail, CaseListResponse, CaseStats } from '@tilik/shared/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';
import { CasesService } from './cases.service';
import { ListCasesQuery } from './dto/list-cases.query';

/**
 * Read-only case endpoints for the portal. The list + detail land here (Prompt 11); reviewer-owned writes
 * (status/assignedTo/summary/Decision) are Prompt 12. This module must NEVER write the detector-owned
 * `severity`/existence (two-writer Case contract) — everything here is a read.
 *
 * No @Audit: these are GETs (the interceptor skips them by design). The per-case VIEW_CASE audit is a
 * standalone insert inside CasesService.detail (a read has no domain tx to join). stats is aggregate — it
 * never audits.
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

  @Get()
  @Roles(Role.REVIEWER)
  list(@Query() query: ListCasesQuery): Promise<CaseListResponse> {
    return this.cases.list(query);
  }

  @Get(':id')
  @Roles(Role.REVIEWER)
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<CaseDetail> {
    return this.cases.detail(id, user);
  }
}
