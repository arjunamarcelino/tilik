import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@tilik/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';
import { CasesService } from './cases.service';

/**
 * Case-scoped evidence download. All lookup / BOLA scoping / verify-before-stream / tamper-audit live in
 * `CasesService.loadEvidenceForDownload` (the single owner of the case↔evidence authz rule); this controller
 * is thin — it only sets the response hardening headers and streams the verified bytes. PDFs download as
 * attachments (never inline-embedded), and the binary carries a locked-down resource CSP + `nosniff`.
 */
@Controller('cases/:caseId/evidence')
export class EvidenceController {
  constructor(private readonly cases: CasesService) {}

  @Get(':evidenceId/download')
  @Roles(Role.REVIEWER)
  async download(
    @Param('caseId') caseId: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, contentType, filename } = await this.cases.loadEvidenceForDownload(
      caseId,
      evidenceId,
      user,
    );

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Authorization');
    // Lock the binary down to its own origin-less resource policy (it must never execute as a document).
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
