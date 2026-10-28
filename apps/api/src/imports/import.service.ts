import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AUDIT_ACTION, OUTBOX_JOB_TYPE } from '@tilik/shared/constants';
import { Prisma, type ImportBatch } from '@tilik/db';
import { Role } from '@tilik/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/auth';
import type { EnvironmentVariables } from '../config/env.validation';
import { MinioService, type StoredObject } from '../minio/minio.service';
import { PrismaService } from '../prisma/prisma.service';
import { claimVersionContentHash, evidencePayloadContentHash } from './canonical';
import { flattenManifest, type ImportManifest, isImportManifest } from './manifest';
import { validateAll } from './record-validation';
import { resolve, type ResolvedEpisode } from './ref-resolver';
import { patientToken } from './tokenize';
import type { ImportResult, RawRecord } from './types';

// A batch wedged in PROCESSING longer than this (crash mid-request) is reclaimable on replay.
const STALE_PROCESSING_MS = 5 * 60 * 1000;
// Evidence file types we accept; the stored Content-Type is derived from here, never the client's.
const CONTENT_TYPE: Record<string, string> = { png: 'image/png', pdf: 'application/pdf' };

type MultipartFile = { fieldname: string; buffer: Buffer };

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly hmacKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly minio: MinioService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.hmacKey = config.get('PATIENT_TOKEN_HMAC_KEY', { infer: true });
  }

  async import(
    user: AuthenticatedUser,
    key: string,
    files: MultipartFile[],
  ): Promise<ImportResult> {
    // 1. Claim the per-actor idempotency key. The unique (uploadedBy, idempotencyKey) is the concurrency
    //    primitive: exactly one INSERT wins; a duplicate branches to replay / 409 / stale-reclaim.
    let batch: ImportBatch;
    try {
      batch = await this.prisma.importBatch.create({
        data: {
          idempotencyKey: key,
          uploadedBy: user.userId,
          status: 'PROCESSING',
          totalRecords: 0,
          acceptedRecords: 0,
          rejectedRecords: 0,
        },
      });
    } catch (err) {
      if (isP2002(err)) return this.replayOrConflict(user.userId, key);
      throw err;
    }

    // 2. Durable "an import began" record (actor + batch + time) BEFORE any domain state can land, so a
    //    crash before finalize never leaves committed claims without an audit trail.
    await this.audit.record({
      actor: user.userId,
      action: AUDIT_ACTION.IMPORT_STARTED,
      targetType: 'ImportBatch',
      targetId: batch.id,
    });

    try {
      return await this.process(user, batch.id, files);
    } catch (err) {
      await this.failBatch(batch.id, err);
      throw err; // BadRequestException → 400; anything else → AllExceptionsFilter sanitizes to a generic 500
    }
  }

  private async process(
    user: AuthenticatedUser,
    batchId: string,
    files: MultipartFile[],
  ): Promise<ImportResult> {
    // Parse the manifest part.
    const manifestPart = files.find((f) => f.fieldname === 'manifest');
    if (!manifestPart) throw new BadRequestException({ code: 'MANIFEST_MISSING' });
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestPart.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException({ code: 'MANIFEST_INVALID_JSON' });
    }
    if (!isImportManifest(manifest))
      throw new BadRequestException({ code: 'MANIFEST_INVALID_SHAPE' });

    // Upload declared file evidence to MinIO (manifest-gated, ref-allowlisted, ext-allowlisted).
    const fileObjects = await this.uploadEvidenceFiles(batchId, manifest, files);

    // Stage raw (redacted) + validate + resolve.
    const records = flattenManifest(manifest);
    await this.stageRedacted(batchId, records);
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { totalRecords: records.length },
    });

    const results = await validateAll(records);
    const { episodes, acceptedRefs, rejections } = resolve(results, fileObjects);

    // Mark staging outcomes: accepted in bulk, each rejection with its {field,constraint} reason.
    if (acceptedRefs.size > 0) {
      await this.prisma.stagingRecord.updateMany({
        where: { importBatchId: batchId, ref: { in: [...acceptedRefs] } },
        data: { accepted: true },
      });
    }
    for (const r of rejections) {
      await this.prisma.stagingRecord.updateMany({
        where: { importBatchId: batchId, ref: r.ref },
        // FieldError[] is JSON-shaped but lacks the index signature Prisma's InputJsonValue wants.
        data: { rejectionReason: r.errors as unknown as Prisma.InputJsonValue },
      });
    }

    // Write each episode atomically (canonical rows + its DETECT_EPISODE outbox job).
    for (const episode of episodes) await this.writeEpisode(batchId, episode);

    return this.finalize(
      user,
      batchId,
      acceptedRefs.size,
      rejections.length,
      records.length,
      rejections,
    );
  }

  private async uploadEvidenceFiles(
    batchId: string,
    manifest: ImportManifest,
    files: MultipartFile[],
  ): Promise<Map<string, StoredObject>> {
    // ref → {ext, contentType}, for evidence records that declare an allowlisted file (the only uploads we accept).
    const declared = new Map<string, { ext: string; contentType: string }>();
    for (const ev of manifest.evidenceRecords) {
      const ref = ev.ref;
      const file = ev.file;
      if (typeof ref !== 'string' || typeof file !== 'string') continue;
      const ext = file.split('.').pop()?.toLowerCase() ?? '';
      const contentType = CONTENT_TYPE[ext];
      if (contentType) declared.set(ref, { ext, contentType });
    }

    const out = new Map<string, StoredObject>();
    for (const part of files) {
      const ref = part.fieldname;
      if (ref === 'manifest') continue;
      const spec = declared.get(ref);
      // Drop parts that aren't a manifest-declared, allowlisted, non-duplicate evidence file. (A hostile
      // ref can't reach here: declared keys come from the manifest and REF_RE-validated DTOs.)
      if (!spec || out.has(ref)) continue;
      const stored = await this.minio.putObject(
        `imports/${batchId}/${ref}.${spec.ext}`,
        part.buffer,
        spec.contentType,
      );
      out.set(ref, stored);
    }
    return out;
  }

  /** Stage every record verbatim EXCEPT the raw patientRef, which is replaced by its token. rawHash is the
   *  sha256 of the original record so "exactly what was submitted" is provable without retaining the id. */
  private async stageRedacted(batchId: string, records: RawRecord[]): Promise<void> {
    const rows = records.map((r) => {
      const rawHash = createHash('sha256').update(JSON.stringify(r.raw)).digest('hex');
      let raw: Prisma.InputJsonValue = r.raw as Prisma.InputJsonValue;
      if (r.recordType === 'episode' && typeof r.raw.patientRef === 'string') {
        raw = { ...r.raw, patientRef: patientToken(r.raw.patientRef, this.hmacKey) };
      }
      return {
        importBatchId: batchId,
        recordType: r.recordType,
        position: r.position,
        ref: r.ref,
        raw,
        rawHash,
      };
    });
    await this.prisma.stagingRecord.createMany({ data: rows });
  }

  private async writeEpisode(batchId: string, ep: ResolvedEpisode): Promise<void> {
    const token = patientToken(ep.dto.patientRef, this.hmacKey);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.episode.create({
          data: {
            id: ep.id,
            patientToken: token,
            facilityId: ep.dto.facilityId,
            startedAt: new Date(ep.dto.startedAt),
            endedAt: ep.dto.endedAt ? new Date(ep.dto.endedAt) : null,
            importBatchId: batchId,
          },
        });

        // D8: plain insert at version=1, isCurrent defaults true — no advisory lock / supersede path.
        for (const claim of ep.claims) {
          await tx.claimVersion.create({
            data: {
              id: claim.id,
              episodeId: ep.id,
              version: claim.dto.version,
              claimNo: claim.dto.claimNo,
              inacbgCode: claim.dto.inacbgCode,
              amount: new Prisma.Decimal(claim.dto.amount),
              contentHash: claimVersionContentHash({
                inacbgCode: claim.dto.inacbgCode,
                amount: claim.dto.amount,
                patientToken: token,
                lines: claim.dto.lines,
              }),
              status: claim.dto.status,
              submittedAt: new Date(claim.dto.submittedAt),
              importBatchId: batchId,
            },
          });
          if (claim.dto.lines.length > 0) {
            await tx.claimLine.createMany({
              data: claim.dto.lines.map((l) => ({
                claimVersionId: claim.id,
                type: l.type,
                code: l.code,
                sequence: l.sequence,
                description: l.description ?? null,
                amount: l.amount == null ? null : new Prisma.Decimal(l.amount),
              })),
            });
          }
        }

        if (ep.evidence.length > 0) {
          await tx.evidenceRecord.createMany({
            data: ep.evidence.map((e) => ({
              id: e.id,
              episodeId: ep.id,
              kind: e.dto.kind,
              objectKey: e.object?.objectKey ?? null,
              payload: e.object ? Prisma.DbNull : (e.dto.payload as Prisma.InputJsonValue),
              contentHash: e.object
                ? e.object.sha256
                : evidencePayloadContentHash({
                    kind: e.dto.kind,
                    source: e.dto.source ?? null,
                    capturedAt: e.dto.capturedAt,
                    payload: e.dto.payload ?? null,
                  }),
              ingestedBy: e.dto.ingestedBy ?? null,
              source: e.dto.source ?? null,
              capturedAt: new Date(e.dto.capturedAt),
              importBatchId: batchId,
            })),
          });
        }

        if (ep.links.length > 0) {
          await tx.evidenceLink.createMany({
            data: ep.links.map((l) => ({
              evidenceId: l.evidenceId,
              claimVersionId: l.claimVersionId,
              relation: l.dto.relation,
              note: l.dto.note ?? null,
            })),
          });
        }

        // Same transaction as the canonical rows: no episode lands without its detection job.
        await tx.outboxJob.create({
          data: {
            type: OUTBOX_JOB_TYPE.DETECT_EPISODE,
            status: 'PENDING',
            payload: { v: 1, episodeId: ep.id, importBatchId: batchId },
          },
        });
      },
      {
        timeout: 30_000,
        maxWait: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  private async finalize(
    user: AuthenticatedUser,
    batchId: string,
    accepted: number,
    rejected: number,
    received: number,
    rejections: ImportResult['rejected'],
  ): Promise<ImportResult> {
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'DONE', // "PARTIAL" is derived at the API from rejected>0 (D8 — no such JobStatus)
          acceptedRecords: accepted,
          rejectedRecords: rejected,
          completedAt: new Date(),
        },
      });
      await this.audit.recordInTx(tx, {
        actor: user.userId,
        action: AUDIT_ACTION.IMPORT,
        targetType: 'ImportBatch',
        targetId: batchId,
        metadata: { accepted, rejected, total: received }, // bounded, counts-only (no PII)
      });
      return b;
    });
    return this.toResult(batch, received, rejections);
  }

  /** Best-effort: record FAILED + a sanitized code. Must tolerate its own write failing (don't rethrow). */
  private async failBatch(batchId: string, err: unknown): Promise<void> {
    const code = err instanceof BadRequestException ? 'PARSE_ERROR' : 'INFRA_ERROR';
    this.logger.error(
      `Import batch ${batchId} failed (${code})`,
      err instanceof Error ? err.stack : undefined,
    );
    try {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'FAILED', error: code, completedAt: new Date() },
      });
    } catch (updateErr) {
      this.logger.error(
        `Could not mark batch ${batchId} FAILED`,
        updateErr instanceof Error ? updateErr.stack : undefined,
      );
    }
  }

  private async replayOrConflict(uploadedBy: string, key: string): Promise<ImportResult> {
    const prior = await this.prisma.importBatch.findUnique({
      where: { uploadedBy_idempotencyKey: { uploadedBy, idempotencyKey: key } },
    });
    if (!prior) throw new BadRequestException({ code: 'IDEMPOTENCY_RACE' }); // vanished between insert and read
    if (prior.status === 'PROCESSING') {
      const stale = Date.now() - prior.updatedAt.getTime() > STALE_PROCESSING_MS;
      // 409 while genuinely in flight; a crashed (stale) batch falls through to be observed as-is (a full
      // reclaim/retry is Prompt 14).
      if (!stale) throw new ConflictException({ code: 'IMPORT_IN_PROGRESS' });
    }
    const rejections = await this.rejectionsFor(prior.id);
    return this.toResult(prior, prior.totalRecords, rejections);
  }

  async getBatch(user: AuthenticatedUser, id: string): Promise<ImportResult> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException();
    // Uploader-scoped for REVIEWER (no cross-user existence leak); ADMIN sees any.
    if (user.role !== Role.ADMIN && batch.uploadedBy !== user.userId) throw new NotFoundException();
    const rejections = await this.rejectionsFor(batch.id);
    return this.toResult(batch, batch.totalRecords, rejections);
  }

  private async rejectionsFor(batchId: string): Promise<ImportResult['rejected']> {
    const rows = await this.prisma.stagingRecord.findMany({
      where: { importBatchId: batchId, accepted: false, rejectionReason: { not: Prisma.DbNull } },
      select: { position: true, recordType: true, ref: true, rejectionReason: true },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      position: r.position,
      recordType: r.recordType as ImportResult['rejected'][number]['recordType'],
      ref: r.ref,
      errors: (r.rejectionReason as unknown as ImportResult['rejected'][number]['errors']) ?? [],
    }));
  }

  private toResult(
    batch: ImportBatch,
    received: number,
    rejections: ImportResult['rejected'],
  ): ImportResult {
    const status =
      batch.status === 'DONE' && batch.rejectedRecords > 0
        ? 'PARTIAL'
        : (batch.status as ImportResult['status']);
    return {
      batchId: batch.id,
      status,
      summary: {
        received,
        accepted: batch.acceptedRecords,
        rejected: batch.rejectedRecords,
      },
      rejected: rejections,
    };
  }
}

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
