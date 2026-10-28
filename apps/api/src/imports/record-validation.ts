import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  ClaimVersionDto,
  EpisodeDto,
  EvidenceLinkDto,
  EvidenceRecordDto,
} from './dto/bundle-records.dto';
import type { FieldError, RawRecord, RowResult } from './types';

/** Flatten class-validator's error tree to {field, constraint} — NEVER the offending value (no PII echo). */
function toFieldErrors(errors: ValidationError[], prefix = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const e of errors) {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    for (const constraint of Object.keys(e.constraints ?? {})) out.push({ field, constraint });
    if (e.children?.length) out.push(...toFieldErrors(e.children, field));
  }
  return out;
}

async function runValidate<T extends object>(
  ctor: ClassConstructor<T>,
  raw: Record<string, unknown>,
): Promise<{ dto: T; errors: FieldError[] }> {
  const dto = plainToInstance(ctor, raw);
  const errors = toFieldErrors(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
  return { dto, errors };
}

const rejected = (r: RawRecord, errors: FieldError[]): RowResult => ({
  kind: 'rejected',
  position: r.position,
  ref: r.ref,
  recordType: r.recordType,
  errors,
});

/**
 * Validate every record independently (validate-don't-abort): malformed records become `rejected`
 * RowResults with field/constraint reasons; valid ones carry their typed DTO. Pure — no I/O.
 */
export async function validateAll(records: RawRecord[]): Promise<RowResult[]> {
  return Promise.all(
    records.map(async (r): Promise<RowResult> => {
      switch (r.recordType) {
        case 'episode': {
          const { dto, errors } = await runValidate(EpisodeDto, r.raw);
          return errors.length
            ? rejected(r, errors)
            : { kind: 'episode', position: r.position, ref: r.ref, dto };
        }
        case 'claim-version': {
          const { dto, errors } = await runValidate(ClaimVersionDto, r.raw);
          return errors.length
            ? rejected(r, errors)
            : { kind: 'claim-version', position: r.position, ref: r.ref, dto };
        }
        case 'evidence-record': {
          const { dto, errors } = await runValidate(EvidenceRecordDto, r.raw);
          // Evidence must carry EXACTLY one of payload/file (the DB CHECK only enforces at-least-one).
          const hasPayload = dto.payload != null;
          const hasFile = typeof dto.file === 'string' && dto.file.length > 0;
          if (hasPayload === hasFile)
            errors.push({ field: 'payload|file', constraint: 'exactlyOne' });
          return errors.length
            ? rejected(r, errors)
            : { kind: 'evidence-record', position: r.position, ref: r.ref, dto };
        }
        case 'evidence-link': {
          const { dto, errors } = await runValidate(EvidenceLinkDto, r.raw);
          return errors.length
            ? rejected(r, errors)
            : { kind: 'evidence-link', position: r.position, ref: r.ref, dto };
        }
      }
    }),
  );
}
