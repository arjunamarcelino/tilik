import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@tilik/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceIntegrityService } from './evidence-integrity.service';

// Served content types, keyed by the object-key extension — never a client-declared MIME.
const CONTENT_TYPE: Record<string, string> = { png: 'image/png', pdf: 'application/pdf' };

/**
 * Case-scoped evidence download. The route carries the caseId so access is bound to a visible case and the
 * evidence is verified to belong to that case's episode (prevents BOLA — a bare `/evidence/:id` would serve
 * evidence for episodes that never became a Case). Verify-before-stream: the bytes are hashed against the
 * append-only DB `contentHash` and a mismatch is audited + 409'd BEFORE the first byte ships. PDFs download
 * as attachments (never inline-embedded), and the binary carries a locked-down resource CSP + `nosniff`.
 */
@Controller('cases/:caseId/evidence')
export class EvidenceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrity: EvidenceIntegrityService,
    private readonly audit: AuditService,
  ) {}

  @Get(':evidenceId/download')
  @Roles(Role.REVIEWER)
  async download(
    @Param('caseId') caseId: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { episodeId: true },
    });
    if (!kase) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });

    const evidence = await this.prisma.evidenceRecord.findUnique({
      where: { id: evidenceId },
      select: {
        episodeId: true,
        objectKey: true,
        contentHash: true,
        hashAlgo: true,
      },
    });
    // 404 (not 403) on a cross-case or missing id — don't disclose existence outside the case context.
    if (!evidence || evidence.episodeId !== kase.episodeId || evidence.objectKey === null) {
      throw new NotFoundException({ code: 'EVIDENCE_NOT_FOUND' });
    }

    let loaded: { buffer: Buffer; verified: boolean; computed: string };
    try {
      loaded = await this.integrity.loadForDownload(evidence);
    } catch {
      // objectKey is set but the object isn't in storage — treat as not found (distinct from tamper).
      throw new NotFoundException({ code: 'EVIDENCE_FILE_MISSING' });
    }

    if (!loaded.verified) {
      // Tamper detected — the product's core event. Audit it (never the raw bytes) before refusing.
      await this.audit.record({
        actor: user.userId,
        action: 'EVIDENCE_INTEGRITY_FAILED',
        targetType: 'EvidenceRecord',
        targetId: evidenceId,
        metadata: { caseId, expected: evidence.contentHash, computed: loaded.computed },
      });
      throw new ConflictException({ code: 'EVIDENCE_INTEGRITY_FAILED' });
    }

    const ext = evidence.objectKey.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';
    // Server-controlled, ASCII-safe filename — never reflect objectKey/user input into the header.
    const filename = `evidence-${evidenceId}.${ext || 'bin'}`;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Authorization');
    // Lock the binary down to its own origin-less resource policy (it must never execute as a document).
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    return new StreamableFile(loaded.buffer, {
      type: contentType,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
