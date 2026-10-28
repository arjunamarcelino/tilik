import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Role } from '@tilik/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/auth';
import { ImportsService } from './imports.service';
import type { ImportResult } from './types';

// Evidence files are tiny (synthetic bundle: < 1 KiB) and the manifest part is ~a few hundred KiB; a 5 MiB
// per-part cap is generous headroom while bounding the in-memory buffer (anti-DoS).
const MAX_PART_BYTES = 5 * 1024 * 1024;
const MAX_PARTS = 600;

/**
 * NO @Audit on these routes: the import audits itself via AuditService.record (IMPORT_STARTED) and
 * recordInTx (terminal IMPORT) inside its own transaction. (No markAuditedInTx is needed — that marker
 * only matters for a route carrying BOTH @Audit and recordInTx, which this is not.)
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  // ADMIN ⊇ REVIEWER in RolesGuard, so REVIEWER tags the lowest sufficient role (ADMIN passes too).
  @Roles(Role.REVIEWER)
  // AnyFilesInterceptor relies on Nest's DEFAULT in-memory multer storage so part.buffer is populated
  // (ImportsService reads buffers). Do NOT register MulterModule with disk storage or buffer goes undefined.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_PART_BYTES, files: MAX_PARTS } }))
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportResult> {
    if (!key?.trim() || key.length > 255) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    const result = await this.imports.import(user, key.trim(), files ?? []);
    // 201 all-imported · 207 partial · 200 replay of a prior terminal/in-flight batch.
    res.status(
      result.status === 'DONE'
        ? HttpStatus.CREATED
        : result.status === 'PARTIAL'
          ? HttpStatus.MULTI_STATUS
          : HttpStatus.OK,
    );
    return result;
  }

  @Get(':id')
  @Roles(Role.REVIEWER)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ImportResult> {
    return this.imports.getBatch(user, id);
  }
}
