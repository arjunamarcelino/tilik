/**
 * Cross-service API response DTOs — the single source of truth for the shapes the NestJS API returns
 * and the Next.js portal consumes. Reachable only via the "@tilik/shared/contracts" subpath (kept off
 * the root barrel, like ./constants, so the enum-parity guard's barrel stays enum-only).
 *
 * These are **response contracts**, distinct from Prisma persistence models (which stay in @tilik/db).
 * Types only — no runtime, no dependencies. The web app pins them at the trust boundary with zod
 * schemas annotated `satisfies z.ZodType<…>`, so a schema that drifts from these types fails to compile.
 */
import type {
  CaseStatus,
  ClaimLineType,
  ClaimStatus,
  DetectorType,
  EvidenceKind,
  Role,
  Severity,
} from './enums';

/**
 * ISO-8601 UTC timestamp (e.g. "2026-10-31T12:00:00.000Z"). Dates cross JSON as strings, so every
 * timestamp field below is typed as this alias — the API maps Prisma `Date`s with an explicit
 * `.toISOString()`, and the web validates with `z.string().datetime()` (a `z.date()` schema would throw
 * at `.parse()` on every response).
 */
export type IsoDateString = string;

/** `GET /v1/auth/me` — the authenticated caller's safe profile (never passwordHash). */
export interface Me {
  id: string;
  email: string;
  role: Role;
}

/**
 * `GET /v1/cases/stats` — dashboard counts. Every enum key is present (zero-filled server-side), so the
 * UI needs no `?? 0` under `noUncheckedIndexedAccess`.
 *
 * NOTE the two denominators: `byStatus` is over ALL cases (the pipeline); `bySeverity` is over OPEN
 * cases only (the triage figure). The dashboard must label each panel so the mix isn't confusing.
 */
export interface CaseStats {
  /** = sum(byStatus); derived in JS, no separate count() query. */
  total: number;
  /** = byStatus.OPEN. */
  open: number;
  /** All 5 CaseStatus keys, zero-filled — over all cases. */
  byStatus: Record<CaseStatus, number>;
  /** LOW/MEDIUM/HIGH, zero-filled — over OPEN cases only. */
  bySeverity: Record<Severity, number>;
}

// ── Prompt 11: case list + detail ────────────────────────────────────────────────────────────────

/** EvidenceLink.relation — a plain CHECK-constrained string column, not an enum. */
export type EvidenceRelation = 'mendukung' | 'bertentangan' | 'sumber';

/**
 * Content-hash verification verdict for one evidence record, recomputed at read time.
 *   - verified     — file bytes hash to the recorded contentHash (tamper-evident ✓)
 *   - mismatch     — bytes DON'T match → tampered
 *   - unavailable  — the MinIO object couldn't be read (distinct from mismatch — operational, not tamper)
 *   - display_only — payload-backed evidence: the stored hash is shown, not recomputed (its hash is over a
 *                    canonical wrapper whose timestamp round-trip would false-mismatch)
 *   - pending      — not yet verified (reserved so an eager→lazy switch needs no contract change)
 * `download` on the record (not this field) tells file-backed vs payload-backed.
 */
export type EvidenceIntegrityStatus =
  'pending' | 'verified' | 'mismatch' | 'unavailable' | 'display_only';

export interface EvidenceIntegrity {
  status: EvidenceIntegrityStatus;
  /** The recorded hash (hex), the append-only DB authority — safe to display. */
  contentHash: string;
  hashAlgo: string;
}

/** `GET /v1/cases` — one row. `createdAt` is an ISO string (see IsoDateString). */
export interface CaseListItem {
  id: string;
  episodeId: string;
  severity: Severity;
  status: CaseStatus;
  /** Distinct detectors across the case's findings (badge set). */
  detectors: DetectorType[];
  findingCount: number;
  createdAt: IsoDateString;
}

export interface CaseListResponse {
  items: CaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Human-readable detector output. `messages` is Indonesian reviewer text; `detail` is per-detector. */
export interface FindingReasons {
  messages: string[];
  detail: Record<string, unknown>;
}

export interface FindingDTO {
  id: string;
  detector: DetectorType;
  /** 0..1 — meaning differs per detector (cloning = cosine, repeat-billing = count); label it in the UI. */
  score: number;
  severity: Severity;
  reasons: FindingReasons;
  /** EvidenceRecord ids this finding points at (soft refs; may be empty). */
  evidenceRefs: string[];
  claimVersionId: string | null;
}

export interface ClaimLineDTO {
  id: string;
  type: ClaimLineType;
  code: string;
  sequence: number;
  description: string | null;
  /** Decimal serialized as a fixed-scale string. */
  amount: string | null;
}

export interface ClaimVersionDTO {
  id: string;
  claimNo: string;
  version: number;
  inacbgCode: string;
  amount: string;
  status: ClaimStatus;
  isCurrent: boolean;
  submittedAt: IsoDateString;
  lines: ClaimLineDTO[];
}

export interface EvidenceRecordDTO {
  id: string;
  kind: EvidenceKind;
  capturedAt: IsoDateString;
  source: string | null;
  ingestedBy: string | null;
  integrity: EvidenceIntegrity;
  /**
   * Present ⇔ file-backed (downloadable via the BFF proxy); null ⇔ payload-backed (rendered inline).
   * `isImage` lets the UI render an inline <img> vs a download link without exposing the object key/ext.
   */
  download: { href: string; isImage: boolean } | null;
  /** Present ⇔ payload-backed; the raw JSON blob (untrusted shape). Absent/null for file-backed records. */
  payload?: unknown;
}

export interface EvidenceLinkDTO {
  id: string;
  relation: EvidenceRelation;
  evidenceId: string;
  claimVersionId: string | null;
  note: string | null;
}

/** One audit-timeline entry. `actorKind` separates the detector (system) from a reviewer (human). */
export type AuditActorKind = 'human' | 'system';
export interface AuditEventDTO {
  id: string;
  action: string;
  actorLabel: string;
  actorKind: AuditActorKind;
  targetType: string;
  at: IsoDateString;
}

/** `GET /v1/cases/:id` — the full review surface for one case. */
export interface CaseDetail {
  id: string;
  episodeId: string;
  status: CaseStatus;
  severity: Severity;
  assignedTo: string | null;
  summary: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  /** HMAC pseudonym — safe to surface; never a real patient id. */
  patientToken: string;
  facilityId: string;
  findings: FindingDTO[];
  claimVersions: ClaimVersionDTO[];
  evidence: EvidenceRecordDTO[];
  /** All evidence↔claim links; the UI flags `relation === 'bertentangan'` as contradictions. */
  evidenceLinks: EvidenceLinkDTO[];
  /** Chronological audit trail (import → detect → views), actor-labelled. */
  timeline: AuditEventDTO[];
}
