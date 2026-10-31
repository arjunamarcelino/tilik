import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@tilik/shared';
import type {
  CaseDecision,
  CaseDetail,
  CaseListResponse,
  CaseStats,
} from '@tilik/shared/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';
import { CasesService } from './cases.service';
import { DecideCaseDto } from './dto/decide-case.dto';
import { ListCasesQuery } from './dto/list-cases.query';

/**
 * Case endpoints for the portal. The list + detail are reads (Prompt 11); the decision POST (Prompt 12) is
 * the one reviewer-owned write — it sets status/assignedTo + the Decision row. This module writes ONLY the
 * reviewer-owned surface; it must NEVER write the detector-owned `severity`/existence (two-writer Case).
 *
 * The GETs carry no @Audit (the interceptor skips them by design); the per-case VIEW_CASE audit is a
 * standalone insert inside CasesService.detail. The decision POST carries no @Audit either — it records its
 * DECIDE event in-transaction via recordInTx (a domain mutation; @Audit XOR recordInTx). stats never audits.
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

  // The reviewer's verdict. @Roles is mandatory (RolesGuard fails open without it); ADMIN ⊇ REVIEWER.
  // No @Audit — decide() records its DECIDE event in-transaction (recordInTx).
  @Post(':id/decision')
  @Roles(Role.REVIEWER)
  decide(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecideCaseDto,
  ): Promise<CaseDecision> {
    return this.cases.decide(id, user, dto);
  }
}
