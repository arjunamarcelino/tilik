import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
// Prisma enum VALUES (persistence edge) — distinct nominal type from @tilik/shared's enums, but identical
// string members. Aliased so the shared enums below can keep their canonical names in the DTO mappers.
import {
  CaseStatus as PrismaCaseStatus,
  Prisma,
  Severity as PrismaSeverity,
  type AuditEvent,
  type ClaimLine,
  type EvidenceRecord,
  type Finding,
} from '@tilik/db';
import {
  CaseStatus,
  ClaimLineType,
  ClaimStatus,
  DetectorType,
  EvidenceKind,
  Severity,
  Verdict,
} from '@tilik/shared';
import type {
  AuditEventDTO,
  CaseDecision,
  CaseDetail,
  CaseListItem,
  CaseListResponse,
  CaseStats,
  ClaimVersionDTO,
  EvidenceIntegrity,
  EvidenceLinkDTO,
  EvidenceRecordDTO,
  EvidenceRelation,
  FindingDTO,
} from '@tilik/shared/contracts';
import { AuditService } from '../audit/audit.service';
import { mapWithConcurrency } from '../common/concurrency';
import type { AuthenticatedUser } from '../common/types/auth';
import { PrismaService } from '../prisma/prisma.service';
import type { DecideCaseDto } from './dto/decide-case.dto';
import type { ListCasesQuery } from './dto/list-cases.query';
import { EvidenceIntegrityService } from './evidence-integrity.service';
import { parseReasons } from './finding-json';

// VIEW_CASE is written AND read only by the API, so by the shared-constants convention it's an inline
// literal here (not added to @tilik/shared/constants, which is for cross-service actions only).
const ACTION_VIEW_CASE = 'VIEW_CASE';
// DETECT is the one timeline action written by the Python worker (actor = worker id, not a user).
const ACTION_DETECT = 'DETECT';
// A detected content-hash mismatch on download — the product's core tamper event (API-only, inline literal).
const ACTION_EVIDENCE_INTEGRITY_FAILED = 'EVIDENCE_INTEGRITY_FAILED';
// A reviewer's verdict on a case (Prompt 12). API-only (the detector never decides), so inline — not a
// cross-service @tilik/shared/constants action.
const ACTION_DECIDE = 'DECIDE';

// Served content types, keyed by the object-key extension — never a client-declared MIME.
const CONTENT_TYPE: Record<string, string> = { png: 'image/png', pdf: 'application/pdf' };

// Default + max page size; applied here (not via DTO initializers, brittle under `whitelist`).
const DEFAULT_PAGE_SIZE = 20;
// Timeline caps: core (import/detect) events are few, but VIEW_CASE grows unboundedly (each read writes one
// the next read loads), so bound it server-side and keep only the most recent.
const CORE_EVENT_LIMIT = 200;
const VIEW_EVENT_LIMIT = 25;
// Bound on concurrent MinIO reads during one detail verification pass.
const VERIFY_CONCURRENCY = 6;

type ClaimVersionWithLines = Prisma.ClaimVersionGetPayload<{ include: { lines: true } }>;

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrity: EvidenceIntegrityService,
  ) {}

  /**
   * Dashboard counts. ONE read-only grouped query over the non-owner client — so it respects the two-writer
   * Case contract and needs no migration. `byStatus` is over all cases; `bySeverity` is over OPEN cases only.
   */
  async stats(): Promise<CaseStats> {
    const rows = await this.prisma.case.groupBy({
      by: ['status', 'severity'],
      _count: { _all: true },
    });

    const byStatus: Record<PrismaCaseStatus, number> = {
      [PrismaCaseStatus.OPEN]: 0,
      [PrismaCaseStatus.IN_REVIEW]: 0,
      [PrismaCaseStatus.PENDING]: 0,
      [PrismaCaseStatus.ESCALATED]: 0,
      [PrismaCaseStatus.CLOSED]: 0,
    };
    const bySeverity: Record<PrismaSeverity, number> = {
      [PrismaSeverity.LOW]: 0,
      [PrismaSeverity.MEDIUM]: 0,
      [PrismaSeverity.HIGH]: 0,
    };

    let total = 0;
    for (const row of rows) {
      const n = row._count._all;
      total += n;
      byStatus[row.status] += n;
      if (row.status === PrismaCaseStatus.OPEN) bySeverity[row.severity] += n;
    }

    return { total, open: byStatus[PrismaCaseStatus.OPEN], byStatus, bySeverity };
  }

  /**
   * Filterable, paginated case list. Fixed order (severity DESC, createdAt DESC, id DESC) — the `id`
   * tiebreaker makes offset pages deterministic. Two queries, independent of page size: (1) the page of
   * case scalars (no `findings` include → no JSON over-fetch), (2) a single grouped roll-up of the page's
   * findings for the detector-badge set + count. The `count(*)` for `total` runs alongside query 1.
   */
  async list(query: ListCasesQuery): Promise<CaseListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.CaseWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    // "case has ≥1 finding from this detector" — Case has no detector column.
    if (query.detector) where.findings = { some: { detector: query.detector } };

    const [rows, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, episodeId: true, severity: true, status: true, createdAt: true },
      }),
      this.prisma.case.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const grouped = ids.length
      ? await this.prisma.finding.groupBy({
          by: ['caseId', 'detector'],
          where: { caseId: { in: ids } },
          _count: { _all: true },
        })
      : [];

    const agg = new Map<string, { detectors: Set<DetectorType>; count: number }>();
    for (const g of grouped) {
      if (!g.caseId) continue;
      const entry = agg.get(g.caseId) ?? { detectors: new Set<DetectorType>(), count: 0 };
      entry.detectors.add(DetectorType[g.detector]);
      entry.count += g._count._all;
      agg.set(g.caseId, entry);
    }

    const items: CaseListItem[] = rows.map((r) => {
      const a = agg.get(r.id);
      return {
        id: r.id,
        episodeId: r.episodeId,
        severity: Severity[r.severity],
        status: CaseStatus[r.status],
        detectors: a ? [...a.detectors] : [],
        findingCount: a?.count ?? 0,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return { items, total, page, pageSize };
  }

  /**
   * Full case detail. Phased so authz/existence is settled before any fan-out or the audit write:
   * (1) authz `findUnique` → 404 here; (2) the independent branches in parallel (each on an index);
   * (3) per-evidence integrity verification (concurrency-capped); (4) the dynamic-id timeline; (5) the
   * best-effort VIEW_CASE audit. Reads only — the two-writer Case contract holds.
   *
   * VIEW_CASE is written on every detail read — there is no caller-controllable suppression. (A prefetch
   * hint is NOT honoured: a spoofable client header must never gate a security-grade access log. Genuine
   * Next prefetches don't reach here anyway — the case-row links are `prefetch={false}` and the audited
   * read sits below the detail route's `loading.tsx` boundary.)
   */
  async detail(id: string, actor: AuthenticatedUser): Promise<CaseDetail> {
    const base = await this.prisma.case.findUnique({
      where: { id },
      select: {
        id: true,
        episodeId: true,
        status: true,
        severity: true,
        assignedTo: true,
        summary: true,
        createdAt: true,
        updatedAt: true,
        episode: {
          select: { id: true, patientToken: true, facilityId: true, importBatchId: true },
        },
        // Folded into the authz read — one fewer round-trip than a parallel branch (it's a single 0..1 row).
        decision: {
          select: { verdict: true, rationale: true, decidedAt: true },
        },
      },
    });
    if (!base) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });

    const episodeId = base.episode.id;
    const [findings, claimVersions, evidence, links] = await Promise.all([
      this.prisma.finding.findMany({ where: { caseId: id } }),
      this.prisma.claimVersion.findMany({
        where: { episodeId },
        include: { lines: { orderBy: { sequence: 'asc' } } },
        orderBy: [{ claimNo: 'asc' }, { version: 'asc' }],
      }),
      this.prisma.evidenceRecord.findMany({
        where: { episodeId },
        orderBy: { capturedAt: 'asc' },
      }),
      // All links for this episode's evidence (every link has an evidenceId; evidence belongs to one episode).
      this.prisma.evidenceLink.findMany({ where: { evidence: { episodeId } } }),
    ]);

    // The per-evidence MinIO verification (network-bound), the DB-only timeline, and the VIEW_CASE audit
    // write are all independent once existence is confirmed — run them concurrently so the timeline/audit
    // don't wait behind the MinIO round-trips.
    const [evidenceDtos, timeline] = await Promise.all([
      mapWithConcurrency(evidence, VERIFY_CONCURRENCY, async (e) =>
        toEvidenceDTO(e, await this.integrity.verify(e)),
      ),
      this.loadTimeline(
        id,
        episodeId,
        base.episode.importBatchId,
        claimVersions,
        evidence.map((e) => e.id),
      ),
      this.recordView(id, actor, base.severity, base.status),
    ]);

    return {
      id: base.id,
      episodeId,
      status: CaseStatus[base.status],
      severity: Severity[base.severity],
      assignedTo: base.assignedTo,
      summary: base.summary,
      createdAt: base.createdAt.toISOString(),
      updatedAt: base.updatedAt.toISOString(),
      patientToken: base.episode.patientToken,
      facilityId: base.episode.facilityId,
      findings: findings.map(toFindingDTO),
      claimVersions: claimVersions.map(toClaimVersionDTO),
      evidence: evidenceDtos,
      evidenceLinks: links.map(toEvidenceLinkDTO).filter((l): l is EvidenceLinkDTO => l !== null),
      timeline,
      decision: base.decision ? toDecisionDTO(base.decision) : null,
    };
  }

  /**
   * Record the reviewer's verdict on a case — the first reviewer-owned write on Case (Prompt 12). ONE
   * transaction: insert the Decision, transition Case.status to the verdict's lifecycle status (+ claim
   * assignedTo if unassigned), and record the DECIDE audit atomically (recordInTx, no @Audit). Decide-once
   * is a DB invariant (Decision.caseId is unique); a second decision → 409 CASE_ALREADY_DECIDED.
   *
   * Two-writer Case: this writes status/assignedTo (reviewer-owned) only — NEVER severity/existence, which
   * are detector-owned. The DB can't enforce that (both callers are tilik_app), and apps/api has no unit-test
   * harness yet, so the guard today is code review + the end-to-end verification; an automated
   * severity-not-written regression test is a follow-up.
   */
  async decide(id: string, actor: AuthenticatedUser, dto: DecideCaseDto): Promise<CaseDecision> {
    const kase = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true, status: true, assignedTo: true, decision: { select: { id: true } } },
    });
    if (!kase) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    if (kase.decision) throw new ConflictException({ code: 'CASE_ALREADY_DECIDED' });

    const priorStatus = kase.status;
    const newStatus = verdictToStatus(dto.verdict);
    const decidedAt = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        // ON CONFLICT ("caseId") DO NOTHING — the decide-once guard. createMany + skipDuplicates compiles to
        // a conflict-free INSERT, so a racing second decision returns count 0 WITHOUT Postgres raising a
        // unique violation inside this interactive tx. (A plain create() would raise P2002 in-tx and corrupt
        // the request-shared pg-adapter client — prisma/orm#30374.) The count-0 throw is a clean JS rollback.
        const { count } = await tx.decision.createMany({
          data: {
            caseId: id,
            verdict: dto.verdict,
            rationale: dto.rationale,
            decidedBy: actor.userId,
            decidedAt,
          },
          skipDuplicates: true,
        });
        if (count === 0) throw new ConflictException({ code: 'CASE_ALREADY_DECIDED' });

        await tx.case.update({
          where: { id },
          // Reviewer-owned columns only. @updatedAt bumps automatically; severity is left untouched.
          data: { status: newStatus, ...(kase.assignedTo ? {} : { assignedTo: actor.userId }) },
        });

        await this.audit.recordInTx(tx, {
          actor: actor.userId,
          action: ACTION_DECIDE,
          targetType: 'Case',
          targetId: id,
          // Bounded (rationale is @MaxLength(2000)) and never egressed to the portal (toAuditDTO drops metadata).
          metadata: { verdict: dto.verdict, priorStatus, newStatus, rationale: dto.rationale },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    return toDecisionDTO({ verdict: dto.verdict, rationale: dto.rationale, decidedAt });
  }

  /** Best-effort VIEW_CASE access-log write. A read must not fail because its audit insert did — log and
   * swallow so a systematic failure is visible. Returns void so it can ride the detail fan-out's Promise.all. */
  private async recordView(
    caseId: string,
    actor: AuthenticatedUser,
    severity: string,
    status: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actor: actor.userId,
        action: ACTION_VIEW_CASE,
        targetType: 'Case',
        targetId: caseId,
        metadata: { severity, status },
      });
    } catch (err) {
      this.logger.error({ err, caseId, actor: actor.userId }, 'VIEW_CASE audit write failed');
    }
  }

  /**
   * Case-scoped evidence download: owns the lookup, the case↔episode BOLA check, the verify-before-stream,
   * and the tamper audit (the controller is left with only HTTP/stream concerns). Returns the verified
   * bytes + content type + a server-controlled filename, or throws a typed NotFound/Conflict. A mismatch is
   * audited as EVIDENCE_INTEGRITY_FAILED and 409'd before any byte is returned.
   */
  async loadEvidenceForDownload(
    caseId: string,
    evidenceId: string,
    actor: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { episodeId: true },
    });
    if (!kase) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });

    const evidence = await this.prisma.evidenceRecord.findUnique({
      where: { id: evidenceId },
      select: { episodeId: true, objectKey: true, contentHash: true, hashAlgo: true },
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
        actor: actor.userId,
        action: ACTION_EVIDENCE_INTEGRITY_FAILED,
        targetType: 'EvidenceRecord',
        targetId: evidenceId,
        metadata: { caseId, expected: evidence.contentHash, computed: loaded.computed },
      });
      throw new ConflictException({ code: 'EVIDENCE_INTEGRITY_FAILED' });
    }

    const ext = evidence.objectKey.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';
    // Server-controlled, ASCII-safe filename — never reflect objectKey/user input into the header. The id
    // is a cuid today (header-safe), but strip to [A-Za-z0-9_-] so a future id format can't inject header
    // breaks (CR/LF, `"`, `;`) into Content-Disposition.
    const safeId = evidenceId.replace(/[^A-Za-z0-9_-]/g, '');
    const filename = `evidence-${safeId}.${ext || 'bin'}`;
    return { buffer: loaded.buffer, contentType, filename };
  }

  /**
   * The case timeline spans multiple targetIds. Core events (import/detect) are few → load them all (asc);
   * VIEW_CASE grows unboundedly → load only the most recent and merge. The import-batch id set is dynamic
   * (episode + every claim version can differ on resubmission); claim-version ids are folded in to survive
   * a future ClaimVersion-targeted audit; and the episode's evidence ids are included so the product's core
   * tamper event (EVIDENCE_INTEGRITY_FAILED, targetType=EvidenceRecord) actually surfaces in the timeline.
   */
  private async loadTimeline(
    caseId: string,
    episodeId: string,
    episodeBatchId: string | null,
    claimVersions: ClaimVersionWithLines[],
    evidenceIds: string[],
  ): Promise<AuditEventDTO[]> {
    const targetIds = new Set<string>([caseId, episodeId]);
    if (episodeBatchId) targetIds.add(episodeBatchId);
    for (const cv of claimVersions) {
      targetIds.add(cv.id);
      if (cv.importBatchId) targetIds.add(cv.importBatchId);
    }
    for (const eid of evidenceIds) targetIds.add(eid);
    const ids = [...targetIds];

    const [core, views] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: { targetId: { in: ids }, action: { not: ACTION_VIEW_CASE } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CORE_EVENT_LIMIT,
      }),
      this.prisma.auditEvent.findMany({
        where: { targetId: caseId, action: ACTION_VIEW_CASE },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: VIEW_EVENT_LIMIT,
      }),
    ]);

    return [...core, ...views]
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map(toAuditDTO);
  }
}

// ── Row → DTO mappers (module-level; Prisma enum → shared enum via the cast-free `Enum[value]` index) ──

/**
 * Verdict → the lifecycle status the case lands in. CaseStatus is deliberately kept as lifecycle (distinct
 * from the adjudication outcome, which lives on Decision.verdict), so this maps onto the EXISTING enum
 * rather than adding CONFIRMED/REJECTED values (no migration). Returns the Prisma enum so it's assignable to
 * the update input without the shared↔Prisma nominal bridge. Exhaustive (the `never` default fails to
 * compile if a Verdict member is added).
 */
function verdictToStatus(verdict: `${Verdict}`): PrismaCaseStatus {
  switch (verdict) {
    case 'CONFIRMED_FRAUD':
      return PrismaCaseStatus.ESCALATED; // confirmed fraud → needs downstream action
    case 'NOT_FRAUD':
      return PrismaCaseStatus.CLOSED; // cleared
    case 'NEEDS_MORE_INFO':
      return PrismaCaseStatus.PENDING; // parked / inconclusive
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function toDecisionDTO(d: {
  verdict: `${Verdict}`;
  rationale: string;
  decidedAt: Date;
}): CaseDecision {
  return {
    verdict: Verdict[d.verdict],
    rationale: d.rationale,
    // Role-scoped label, never a reviewer identifier — matches the timeline's actor labels (toAuditDTO).
    // decidedBy is stored on the Decision row for accountability but is NOT surfaced to the portal.
    decidedByLabel: 'Reviewer',
    decidedAt: d.decidedAt.toISOString(),
  };
}

function toFindingDTO(f: Finding): FindingDTO {
  return {
    id: f.id,
    detector: DetectorType[f.detector],
    score: f.score,
    severity: Severity[f.severity],
    reasons: parseReasons(f.reasons),
    claimVersionId: f.claimVersionId,
  };
}

function toClaimVersionDTO(cv: ClaimVersionWithLines): ClaimVersionDTO {
  return {
    id: cv.id,
    claimNo: cv.claimNo,
    version: cv.version,
    inacbgCode: cv.inacbgCode,
    amount: cv.amount.toFixed(2),
    status: ClaimStatus[cv.status],
    isCurrent: cv.isCurrent,
    submittedAt: cv.submittedAt.toISOString(),
    lines: cv.lines.map(toClaimLineDTO),
  };
}

function toClaimLineDTO(l: ClaimLine): ClaimVersionDTO['lines'][number] {
  return {
    id: l.id,
    type: ClaimLineType[l.type],
    code: l.code,
    sequence: l.sequence,
    description: l.description,
    amount: l.amount === null ? null : l.amount.toFixed(2),
  };
}

function toEvidenceDTO(e: EvidenceRecord, integrity: EvidenceIntegrity): EvidenceRecordDTO {
  const fileBacked = e.objectKey !== null;
  const ext = fileBacked ? (e.objectKey?.split('.').pop()?.toLowerCase() ?? '') : '';
  return {
    id: e.id,
    kind: EvidenceKind[e.kind],
    capturedAt: e.capturedAt.toISOString(),
    source: e.source,
    ingestedBy: e.ingestedBy,
    integrity,
    // File-backed descriptor only — the portal builds the download URL from its own route. The API must
    // not embed a web path (it's globally /v1-prefixed; the portal route is not).
    download: fileBacked ? { isImage: ext === 'png' } : null,
    payload: fileBacked ? null : (e.payload ?? null),
  };
}

// The DB CHECK constrains EvidenceLink.relation to these, but Prisma types it as a bare `string`. Validate
// at the boundary (don't `as`-cast) so an unexpected value degrades to a dropped link rather than a ZodError
// that would escape getCase's catch and 500 the whole detail page.
const EVIDENCE_RELATIONS: readonly EvidenceRelation[] = ['mendukung', 'bertentangan', 'sumber'];
const isEvidenceRelation = (v: string): v is EvidenceRelation =>
  (EVIDENCE_RELATIONS as readonly string[]).includes(v);

function toEvidenceLinkDTO(link: {
  id: string;
  relation: string;
  evidenceId: string;
  claimVersionId: string | null;
  note: string | null;
}): EvidenceLinkDTO | null {
  if (!isEvidenceRelation(link.relation)) return null;
  return {
    id: link.id,
    relation: link.relation,
    evidenceId: link.evidenceId,
    claimVersionId: link.claimVersionId,
    note: link.note,
  };
}

function toAuditDTO(e: AuditEvent): AuditEventDTO {
  const isSystem = e.action === ACTION_DETECT; // worker-written; actor is a worker id, not a user
  return {
    id: e.id,
    action: e.action,
    actorKind: isSystem ? 'system' : 'human',
    // The display label lives here (single source) — by role, not the raw actor id/email (don't leak
    // reviewer identifiers across the portal). The UI renders this verbatim.
    actorLabel: isSystem ? 'System · Detector' : 'Reviewer',
    targetType: e.targetType,
    at: e.createdAt.toISOString(),
  };
}
