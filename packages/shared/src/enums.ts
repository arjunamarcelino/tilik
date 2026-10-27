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

/**
 * Case lifecycle — distinct from the adjudication outcome (see `Verdict`).
 * A case moves OPEN → IN_REVIEW → (PENDING | ESCALATED) → CLOSED; the outcome
 * is recorded separately on the Decision, so `NEEDS_MORE_INFO` maps to PENDING.
 */
export enum CaseStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  PENDING = 'PENDING',
  ESCALATED = 'ESCALATED',
  CLOSED = 'CLOSED',
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

/** Transactional-outbox / import-batch job lifecycle. */
export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/** FHIR-style claim lineage status (Claim.status analogue). */
export enum ClaimStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  ENTERED_IN_ERROR = 'ENTERED_IN_ERROR',
}

/** Grain of a normalized claim line (FHIR Claim.item). */
export enum ClaimLineType {
  DIAGNOSIS = 'DIAGNOSIS',
  PROCEDURE = 'PROCEDURE',
}
