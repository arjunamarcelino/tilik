/**
 * Canonical Tilik domain enums.
 *
 * These are the single source of truth. The Prisma schema (`packages/db`,
 * Prompt 02) must mirror these exactly — do not redefine them elsewhere.
 */

export enum DetectorType {
  REPEAT_BILLING = 'REPEAT_BILLING',
  CLONING = 'CLONING',
  PERTENTANGAN_BUKTI = 'PERTENTANGAN_BUKTI',
}

export enum Severity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum CaseStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

export enum Verdict {
  CONFIRMED_FRAUD = 'CONFIRMED_FRAUD',
  NOT_FRAUD = 'NOT_FRAUD',
  NEEDS_MORE_INFO = 'NEEDS_MORE_INFO',
}

export enum EvidenceKind {
  MEDICAL_RECORD = 'MEDICAL_RECORD',
  LAB = 'LAB',
  IMAGING = 'IMAGING',
  ATTACHMENT = 'ATTACHMENT',
  CLAIM = 'CLAIM',
}

export enum Role {
  REVIEWER = 'REVIEWER',
  ADMIN = 'ADMIN',
}
