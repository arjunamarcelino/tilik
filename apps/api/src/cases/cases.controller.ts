import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
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
import { GenerateSummaryDto } from './dto/generate-summary.dto';
import { ListCasesQuery } from './dto/list-cases.query';
import { SummaryService } from './summary.service';

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
  constructor(
    private readonly cases: CasesService,
    private readonly summary: SummaryService,
  ) {}

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
  //
  // KNOWN GAP (no segregation of duties): POST /v1/imports is also @Roles(REVIEWER), and a case is scoped only
  // by :id (not by who staged its episode), so one reviewer can both import an episode and decide its case —
  // there is no four-eyes control. Accepted for the synthetic-data prototype; the DECIDE AuditEvent makes it
  // detectable after the fact (same actor as the IMPORT event). A second-reviewer requirement is future work.
  @Post(':id/decision')
  @Roles(Role.REVIEWER)
  decide(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecideCaseDto,
  ): Promise<CaseDecision> {
    return this.cases.decide(id, user, dto);
  }

  // Optional LLM aid (Prompt 13): stream a grounded, no-verdict case summary from Claude, cache it on
  // Case.summary, audit it. @Res (manual streaming) opts this route out of the response interceptors — so no
  // @Audit (SummaryService records in/after the stream) and the global exception filter must only be reached
  // pre-flush (SummaryService never rethrows after the header flush). A tight per-route throttle backstops
  // the loose global 100/60s: each call is a paid Opus request, so cap regenerate-spam at 3/min.
  @Post(':id/summary')
  @Roles(Role.REVIEWER)
  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  summarize(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSummaryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.summary.generate(id, user, dto, res);
  }
}
