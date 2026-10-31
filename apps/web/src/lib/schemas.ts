import { z } from 'zod';
import {
  CaseStatus,
  ClaimLineType,
  ClaimStatus,
  DetectorType,
  EvidenceKind,
  Role,
  Severity,
} from '@tilik/shared';
import type {
  AuditEventDTO,
  CaseDetail,
  CaseListItem,
  CaseListResponse,
  CaseStats,
  ClaimVersionDTO,
  EvidenceIntegrity,
  EvidenceLinkDTO,
  EvidenceRecordDTO,
  FindingDTO,
  FindingReasons,
  Me,
} from '@tilik/shared/contracts';

/**
 * All web-side zod schemas in one place. Response schemas are pinned to the shared contracts via
 * `satisfies z.ZodType<…>` — a schema that drifts from the contract type fails to compile; `schema.parse()`
 * turns silent response drift into a loud failure at the trust boundary (no `as` casts). Request schemas
 * (e.g. login) live here too.
 */

// Request — login credentials. Send EXACTLY { email, password }; the API's forbidNonWhitelisted 400s on extras.
export const LoginCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const count = z.number().int().nonnegative();

export const MeSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(Role),
}) satisfies z.ZodType<Me>;

export const CaseStatsSchema = z.object({
  total: count,
  open: count,
  byStatus: z.object({
    OPEN: count,
    IN_REVIEW: count,
    PENDING: count,
    ESCALATED: count,
    CLOSED: count,
  }),
  bySeverity: z.object({
    LOW: count,
    MEDIUM: count,
    HIGH: count,
  }),
}) satisfies z.ZodType<CaseStats>;

// ── Prompt 11: case list + detail ────────────────────────────────────────────────────────────────

// Timestamps cross JSON as ISO strings — validate the shape (a z.date() schema would throw at parse).
const isoDate = z.string().datetime();

export const CaseListItemSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1),
  severity: z.nativeEnum(Severity),
  status: z.nativeEnum(CaseStatus),
  detectors: z.array(z.nativeEnum(DetectorType)),
  findingCount: count,
  createdAt: isoDate,
}) satisfies z.ZodType<CaseListItem>;

export const CaseListResponseSchema = z.object({
  items: z.array(CaseListItemSchema),
  total: count,
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
}) satisfies z.ZodType<CaseListResponse>;

const FindingReasonsSchema = z.object({
  messages: z.array(z.string()),
  detail: z.record(z.unknown()),
}) satisfies z.ZodType<FindingReasons>;

const FindingSchema = z.object({
  id: z.string().min(1),
  detector: z.nativeEnum(DetectorType),
  score: z.number(),
  severity: z.nativeEnum(Severity),
  reasons: FindingReasonsSchema,
  evidenceRefs: z.array(z.string()),
  claimVersionId: z.string().nullable(),
}) satisfies z.ZodType<FindingDTO>;

const EvidenceIntegritySchema = z.object({
  status: z.enum(['pending', 'verified', 'mismatch', 'unavailable', 'display_only']),
  contentHash: z.string(),
  hashAlgo: z.string(),
}) satisfies z.ZodType<EvidenceIntegrity>;

const EvidenceRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.nativeEnum(EvidenceKind),
  capturedAt: isoDate,
  source: z.string().nullable(),
  ingestedBy: z.string().nullable(),
  integrity: EvidenceIntegritySchema,
  download: z.object({ href: z.string(), isImage: z.boolean() }).nullable(),
  payload: z.unknown(),
}) satisfies z.ZodType<EvidenceRecordDTO>;

const ClaimLineSchema = z.object({
  id: z.string().min(1),
  type: z.nativeEnum(ClaimLineType),
  code: z.string(),
  sequence: z.number().int(),
  description: z.string().nullable(),
  amount: z.string().nullable(),
});

const ClaimVersionSchema = z.object({
  id: z.string().min(1),
  claimNo: z.string(),
  version: z.number().int(),
  inacbgCode: z.string(),
  amount: z.string(),
  status: z.nativeEnum(ClaimStatus),
  isCurrent: z.boolean(),
  submittedAt: isoDate,
  lines: z.array(ClaimLineSchema),
}) satisfies z.ZodType<ClaimVersionDTO>;

const EvidenceLinkSchema = z.object({
  id: z.string().min(1),
  relation: z.enum(['mendukung', 'bertentangan', 'sumber']),
  evidenceId: z.string().min(1),
  claimVersionId: z.string().nullable(),
  note: z.string().nullable(),
}) satisfies z.ZodType<EvidenceLinkDTO>;

const AuditEventSchema = z.object({
  id: z.string().min(1),
  action: z.string(),
  actorLabel: z.string(),
  actorKind: z.enum(['human', 'system']),
  targetType: z.string(),
  at: isoDate,
}) satisfies z.ZodType<AuditEventDTO>;

export const CaseDetailSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1),
  status: z.nativeEnum(CaseStatus),
  severity: z.nativeEnum(Severity),
  assignedTo: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  patientToken: z.string(),
  facilityId: z.string(),
  findings: z.array(FindingSchema),
  claimVersions: z.array(ClaimVersionSchema),
  evidence: z.array(EvidenceRecordSchema),
  evidenceLinks: z.array(EvidenceLinkSchema),
  timeline: z.array(AuditEventSchema),
}) satisfies z.ZodType<CaseDetail>;
