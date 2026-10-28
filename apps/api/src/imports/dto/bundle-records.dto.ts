import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ClaimLineType, ClaimStatus, EvidenceKind } from '@tilik/shared';

// Surrogate ref scheme (ep_/cv_/ev_/el_ + alphanumerics). Anchored so a hostile ref can never contain a
// slash/dot and escape the imports/<batchId>/ MinIO key prefix.
export const REF_RE = /^(ep_|cv_|ev_|el_)[A-Za-z0-9]+$/;
// Money as a fixed-scale decimal string (≤ 12 integer digits → fits Decimal(14,2); CHECK amount >= 0).
const AMOUNT_RE = /^\d{1,12}\.\d{2}$/;
// patientRef restricted to printable ASCII (no spaces/control) so JS toUpperCase ↔ Python str.upper can't diverge.
const ASCII_RE = /^[!-~]+$/;

const EVIDENCE_RELATIONS = ['mendukung', 'bertentangan', 'sumber'] as const;

export class EpisodeDto {
  @Matches(REF_RE) ref!: string;
  @Matches(ASCII_RE) patientRef!: string;
  @IsString() facilityId!: string;
  @IsISO8601({ strict: true }) startedAt!: string;
  @IsOptional() @IsISO8601({ strict: true }) endedAt?: string | null;
}

export class ClaimLineDto {
  // Typed as the enum's string-literal union (`${Enum}`) — validated against @tilik/shared at runtime, and
  // assignable to Prisma's structural enum at the persistence edge without a cast (parity guard keeps them equal).
  @IsIn(Object.values(ClaimLineType)) type!: `${ClaimLineType}`;
  @IsString() code!: string;
  @IsInt() @Min(1) sequence!: number;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @Matches(AMOUNT_RE) amount?: string | null;
}

export class ClaimVersionDto {
  @Matches(REF_RE) ref!: string;
  @Matches(REF_RE) episodeRef!: string;
  @IsString() claimNo!: string;
  @IsString() inacbgCode!: string;
  @Matches(AMOUNT_RE) amount!: string;
  @IsIn(Object.values(ClaimStatus)) status!: `${ClaimStatus}`;
  @IsInt() @Min(1) version!: number;
  @IsISO8601({ strict: true }) submittedAt!: string;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines!: ClaimLineDto[];
}

export class EvidenceRecordDto {
  @Matches(REF_RE) ref!: string;
  @Matches(REF_RE) episodeRef!: string;
  @IsIn(Object.values(EvidenceKind)) kind!: `${EvidenceKind}`;
  @IsISO8601({ strict: true }) capturedAt!: string;
  @IsOptional() @IsString() ingestedBy?: string | null;
  @IsOptional() @IsString() source?: string | null;
  // payload XOR file is enforced in record-validation.ts (the DB CHECK is only at-least-one).
  @IsOptional() @IsObject() payload?: Record<string, unknown> | null;
  // "files/<name>.<png|pdf>" — the path shape + extension allow-list are validated here, so the upload path
  // never derives a Content-Type or object key from an unvalidated/non-allowlisted file reference.
  @IsOptional() @Matches(/^files\/[A-Za-z0-9._-]+\.(png|pdf)$/) file?: string | null;
}

export class EvidenceLinkDto {
  @Matches(REF_RE) ref!: string;
  @Matches(REF_RE) evidenceRef!: string;
  @IsOptional() @Matches(REF_RE) claimVersionRef?: string | null;
  @IsIn(EVIDENCE_RELATIONS) relation!: (typeof EVIDENCE_RELATIONS)[number];
  @IsOptional() @IsString() note?: string | null;
}
