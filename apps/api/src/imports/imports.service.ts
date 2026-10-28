import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_ACTION, OUTBOX_JOB_TYPE } from '@tilik/shared/constants';
import { Prisma, type ImportBatch } from '@tilik/db';
import { Role } from '@tilik/shared';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { fromJsonValue, toJsonValue } from '../common/prisma-json';
import type { AuthenticatedUser } from '../common/types/auth';
import type { EnvironmentVariables } from '../config/env.validation';
import { MinioService, type StoredObject } from '../minio/minio.service';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalDigest, claimVersionContentHash, evidencePayloadContentHash } from './canonical';
import { REF_RE } from './dto/bundle-records.dto';
import { flattenManifest, isImportManifest } from './manifest';
import { validateAll } from './record-validation';
import { resolve, type ResolvedEpisode } from './ref-resolver';
import { patientToken } from './tokenize';
import type { ImportResult, RawRecord, Rejection, RowResult } from './types';

// A batch wedged in PROCESSING longer than this (crash mid-request) is reclaimable on replay.
const STALE_PROCESSING_MS = 5 * 60 * 1000;
// Evidence file types we accept; the stored Content-Type is derived from here, never the client's.
const CONTENT_TYPE: Record<string, string> = { png: 'image/png', pdf: 'application/pdf' };

type MultipartFile = { fieldname: string; buffer: Buffer };

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
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
    // Claim the per-actor idempotency key. UNIQUE(uploadedBy, idempotencyKey) is the concurrency primitive:
    // exactly one INSERT wins; a duplicate branches to replay / 409 / stale-reclaim.
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
      if (isUniqueViolation(err)) return this.replayOrConflict(user.userId, key);
      throw err;
    }

    try {
      // Durable "an import began" record (actor + batch + time) BEFORE any domain state can land. Inside the
      // try so that if even this write fails, the batch is marked FAILED rather than wedged in PROCESSING.
      await this.audit.record({
        actor: user.userId,
        action: AUDIT_ACTION.IMPORT_STARTED,
        targetType: 'ImportBatch',
        targetId: batch.id,
      });
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
    // 1. Parse the manifest part.
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

    // 2. Validate BEFORE staging (so no raw/unvalidated identifier is ever persisted), then resolve.
    const records = flattenManifest(manifest);
    const results = await validateAll(records);
    const partByRef = new Map<string, Buffer>();
    for (const f of files) if (f.fieldname !== 'manifest') partByRef.set(f.fieldname, f.buffer);
    const { episodes, acceptedRefs, rejections } = resolve(results, new Set(partByRef.keys()));

    // 3. Compute each accepted episode's patientToken ONCE (reused for staging redaction + content hashing).
    const tokenByEpisodeRef = new Map<string, string>();
    for (const ep of episodes)
      tokenByEpisodeRef.set(ep.dto.ref, patientToken(ep.dto.patientRef, this.hmacKey));

    // 4. Upload ONLY accepted file-backed evidence to MinIO (no orphans from rejected records).
    const objects = await this.uploadAcceptedEvidence(batchId, episodes, partByRef);

    // 5. Build staging rows (validated + redacted) with their outcome inline — no post-hoc UPDATE, so nothing
    //    is keyed on `ref` (no cross-contamination) and rejected bodies are never stored.
    const rows = this.buildStagingRows(
      batchId,
      records,
      results,
      acceptedRefs,
      rejections,
      tokenByEpisodeRef,
    );
    const accepted = acceptedRefs.size;
    const rejected = records.length - accepted;

    // 6. ONE transaction: staging + canonical rows + per-episode DETECT_EPISODE outbox jobs + finalize + audit.
    //    A failure rolls back EVERYTHING → FAILED truly means nothing committed (no orphan detect jobs, counts
    //    stay consistent). MinIO uploads (step 4) are the only non-transactional side effect; a rollback leaves
    //    their objects orphaned under imports/<batchId>/ (documented; GC is Prompt 14).
    const batch = await this.prisma.$transaction(
      async (tx) => {
        await tx.stagingRecord.createMany({ data: rows });
        for (const ep of episodes) {
          await this.writeEpisode(
            tx,
            batchId,
            ep,
            tokenByEpisodeRef.get(ep.dto.ref) ?? '',
            objects,
          );
        }
        const b = await tx.importBatch.update({
          where: { id: batchId },
          data: {
            status: 'DONE', // "PARTIAL" is derived at the API from rejected>0 (D8 — no such JobStatus)
            totalRecords: records.length,
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
          metadata: { accepted, rejected, total: records.length }, // bounded, counts-only (no PII)
        });
        return b;
      },
      {
        timeout: 60_000,
        maxWait: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    return this.toResult(batch, records.length, rejections);
  }

  private async uploadAcceptedEvidence(
    batchId: string,
    episodes: ResolvedEpisode[],
    partByRef: Map<string, Buffer>,
  ): Promise<Map<string, StoredObject>> {
    const objects = new Map<string, StoredObject>();
    for (const ep of episodes) {
      for (const ev of ep.evidence) {
        const file = ev.dto.file;
        if (typeof file !== 'string' || file.length === 0) continue; // payload-backed evidence
        // Defensive: the ref + file ext were REF_RE/allow-list validated at the DTO boundary; assert before
        // it becomes an object key, so the key is never built from an unvalidated ref (review P2-1).
        if (!REF_RE.test(ev.ref)) throw new Error(`evidence ref failed REF_RE: ${ev.ref}`);
        const buffer = partByRef.get(ev.ref);
        if (!buffer) continue; // resolve already rejected missing uploads; guard defensively
        const ext = file.split('.').pop()?.toLowerCase() ?? '';
        const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';
        objects.set(
          ev.ref,
          await this.minio.putObject(`imports/${batchId}/${ev.ref}.${ext}`, buffer, contentType),
        );
      }
    }
    return objects;
  }

  /**
   * Build one StagingRecord row per incoming record, with its validation outcome inline. The stored `raw` is
   * REDACTED: accepted episodes keep their fields with patientRef→token; accepted non-episodes keep their
   * (whitelisted) DTO; REJECTED records store NO body ({}) — only `rawHash` (a canonical digest of the original
   * submitted record) survives as tamper-evidence. This upholds "the raw identifier is never persisted" even
   * for malformed/hostile input, because staging now runs AFTER validation.
   */
  private buildStagingRows(
    batchId: string,
    records: RawRecord[],
    results: RowResult[],
    acceptedRefs: Set<string>,
    rejections: Rejection[],
    tokenByEpisodeRef: Map<string, string>,
  ): Prisma.StagingRecordCreateManyInput[] {
    const dtoByPosition = new Map<number, RowResult>();
    for (const r of results) if (r.kind !== 'rejected') dtoByPosition.set(r.position, r);
    const rejectionByPosition = new Map<number, Rejection>();
    for (const r of rejections) rejectionByPosition.set(r.position, r);

    return records.map((rec) => {
      const accepted = acceptedRefs.has(rec.ref);
      let raw: Prisma.InputJsonValue = {};
      if (accepted) {
        const res = dtoByPosition.get(rec.position);
        if (res && res.kind === 'episode') {
          raw = toJsonValue({ ...res.dto, patientRef: tokenByEpisodeRef.get(rec.ref) ?? '' });
        } else if (res && res.kind !== 'rejected') {
          raw = toJsonValue({ ...res.dto });
        }
      }
      const rejection = rejectionByPosition.get(rec.position);
      return {
        importBatchId: batchId,
        recordType: rec.recordType,
        position: rec.position,
        ref: rec.ref,
        raw,
        rawHash: canonicalDigest(rec.raw),
        accepted,
        rejectionReason: rejection ? toJsonValue(rejection.errors) : Prisma.DbNull,
      };
    });
  }

  private async writeEpisode(
    tx: Prisma.TransactionClient,
    batchId: string,
    ep: ResolvedEpisode,
    token: string,
    objects: Map<string, StoredObject>,
  ): Promise<void> {
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
    if (ep.claims.length > 0) {
      await tx.claimVersion.createMany({
        data: ep.claims.map((c) => ({
          id: c.id,
          episodeId: ep.id,
          version: c.dto.version,
          claimNo: c.dto.claimNo,
          inacbgCode: c.dto.inacbgCode,
          amount: new Prisma.Decimal(c.dto.amount),
          contentHash: claimVersionContentHash({
            inacbgCode: c.dto.inacbgCode,
            amount: c.dto.amount,
            patientToken: token,
            lines: c.dto.lines,
          }),
          status: c.dto.status,
          submittedAt: new Date(c.dto.submittedAt),
          importBatchId: batchId,
        })),
      });
      const lines = ep.claims.flatMap((c) =>
        c.dto.lines.map((l) => ({
          claimVersionId: c.id,
          type: l.type,
          code: l.code,
          sequence: l.sequence,
          description: l.description ?? null,
          amount: l.amount == null ? null : new Prisma.Decimal(l.amount),
        })),
      );
      if (lines.length > 0) await tx.claimLine.createMany({ data: lines });
    }

    if (ep.evidence.length > 0) {
      await tx.evidenceRecord.createMany({
        data: ep.evidence.map((e) => {
          const object = objects.get(e.ref) ?? null;
          // XOR invariant (enforced in validation): file-backed ⇒ object present; else payload present.
          if (!object && e.dto.payload == null) {
            throw new Error(
              `evidence ${e.ref}: neither object nor payload (XOR invariant violated)`,
            );
          }
          return {
            id: e.id,
            episodeId: ep.id,
            kind: e.dto.kind,
            objectKey: object?.objectKey ?? null,
            payload: object ? Prisma.DbNull : toJsonValue(e.dto.payload),
            contentHash: object
              ? object.sha256
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
          };
        }),
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
      // reclaim/retry is Prompt 14). With the whole-batch transaction, a crashed PROCESSING batch committed nothing.
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

  private async rejectionsFor(batchId: string): Promise<Rejection[]> {
    const rows = await this.prisma.stagingRecord.findMany({
      where: { importBatchId: batchId, accepted: false, rejectionReason: { not: Prisma.DbNull } },
      select: { position: true, recordType: true, ref: true, rejectionReason: true },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      position: r.position,
      recordType: r.recordType as Rejection['recordType'],
      ref: r.ref,
      errors: fromJsonValue<Rejection['errors']>(r.rejectionReason) ?? [],
    }));
  }

  private toResult(batch: ImportBatch, received: number, rejections: Rejection[]): ImportResult {
    const status =
      batch.status === 'DONE' && batch.rejectedRecords > 0
        ? 'PARTIAL'
        : (batch.status as ImportResult['status']);
    return {
      batchId: batch.id,
      status,
      summary: { received, accepted: batch.acceptedRecords, rejected: batch.rejectedRecords },
      rejected: rejections,
    };
  }
}
