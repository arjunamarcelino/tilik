import { randomUUID } from 'node:crypto';
import type {
  ClaimVersionDto,
  EpisodeDto,
  EvidenceLinkDto,
  EvidenceRecordDto,
} from './dto/bundle-records.dto';
import type { FieldError, RecordType, Rejection, RowResult } from './types';

export interface ResolvedClaim {
  id: string;
  dto: ClaimVersionDto;
}
export interface ResolvedEvidence {
  id: string;
  ref: string; // used to look up its uploaded object (file-backed) after resolution
  dto: EvidenceRecordDto;
}
export interface ResolvedLink {
  dto: EvidenceLinkDto;
  evidenceId: string;
  claimVersionId: string | null;
}
export interface ResolvedEpisode {
  id: string;
  dto: EpisodeDto;
  claims: ResolvedClaim[];
  evidence: ResolvedEvidence[];
  links: ResolvedLink[];
}

export interface ResolveResult {
  episodes: ResolvedEpisode[];
  acceptedRefs: Set<string>;
  rejections: Rejection[];
}

const rejectWith = (
  list: Rejection[],
  r: { position: number; ref: string },
  recordType: RecordType,
  errors: FieldError[],
): void => void list.push({ position: r.position, ref: r.ref, recordType, errors });

/**
 * Second pass over validated records: reject duplicates/dangling refs, mint ids, and link surrogate refs to
 * them. A dangling/duplicate child never fails its episode's write — it's counted as rejected. Pure (ids from
 * randomUUID; no I/O). No version lineage (D8: every bundle claim is version=1 into an empty DB).
 *
 * `availableFileRefs` is the set of evidence refs that arrived as a multipart file part — used only to reject
 * file-backed evidence whose part is missing; the actual MinIO upload happens afterwards, for accepted records only.
 */
export function resolve(results: RowResult[], availableFileRefs: Set<string>): ResolveResult {
  const rejections: Rejection[] = [];
  const acceptedRefs = new Set<string>();

  // DTO-level rejections carry straight through.
  for (const r of results) {
    if (r.kind === 'rejected')
      rejections.push({
        position: r.position,
        recordType: r.recordType,
        ref: r.ref,
        errors: r.errors,
      });
  }

  // Duplicate surrogate refs are a malformed bundle: reject EVERY occurrence (a reused id has no safe winner).
  const refCounts = new Map<string, number>();
  for (const r of results)
    if (r.kind !== 'rejected') refCounts.set(r.ref, (refCounts.get(r.ref) ?? 0) + 1);
  const isDuplicateRef = (ref: string): boolean => (refCounts.get(ref) ?? 0) > 1;
  const dupError: FieldError[] = [{ field: 'ref', constraint: 'duplicate' }];

  // Episodes.
  const episodes = new Map<string, ResolvedEpisode>(); // ref → resolved
  for (const r of results) {
    if (r.kind !== 'episode') continue;
    if (isDuplicateRef(r.ref)) {
      rejectWith(rejections, r, 'episode', dupError);
      continue;
    }
    episodes.set(r.ref, { id: randomUUID(), dto: r.dto, claims: [], evidence: [], links: [] });
    acceptedRefs.add(r.ref);
  }

  // Claims: attach to their episode; reject dangling episodeRef and duplicate claimNo (partial-unique would throw).
  const claimIds = new Map<string, string>(); // claim ref → id
  const seenClaimNo = new Set<string>();
  for (const r of results) {
    if (r.kind !== 'claim-version') continue;
    if (isDuplicateRef(r.ref)) {
      rejectWith(rejections, r, 'claim-version', dupError);
      continue;
    }
    const ep = episodes.get(r.dto.episodeRef);
    if (!ep) {
      rejectWith(rejections, r, 'claim-version', [
        { field: 'episodeRef', constraint: 'unresolved' },
      ]);
      continue;
    }
    if (seenClaimNo.has(r.dto.claimNo)) {
      // Two claims share a claimNo (both version=1, isCurrent) → the partial UNIQUE(claimNo) WHERE isCurrent
      // would abort the write. Reject the later one here instead of failing the batch.
      rejectWith(rejections, r, 'claim-version', [{ field: 'claimNo', constraint: 'duplicate' }]);
      continue;
    }
    seenClaimNo.add(r.dto.claimNo);
    const id = randomUUID();
    claimIds.set(r.ref, id);
    ep.claims.push({ id, dto: r.dto });
    acceptedRefs.add(r.ref);
  }

  // Evidence: attach to its episode; file-backed evidence needs an uploaded part.
  const evidenceEpisode = new Map<string, ResolvedEpisode>(); // evidence ref → owning episode
  const evidenceIds = new Map<string, string>(); // evidence ref → id
  for (const r of results) {
    if (r.kind !== 'evidence-record') continue;
    if (isDuplicateRef(r.ref)) {
      rejectWith(rejections, r, 'evidence-record', dupError);
      continue;
    }
    const ep = episodes.get(r.dto.episodeRef);
    if (!ep) {
      rejectWith(rejections, r, 'evidence-record', [
        { field: 'episodeRef', constraint: 'unresolved' },
      ]);
      continue;
    }
    if (typeof r.dto.file === 'string' && r.dto.file.length > 0 && !availableFileRefs.has(r.ref)) {
      rejectWith(rejections, r, 'evidence-record', [
        { field: 'file', constraint: 'missingUpload' },
      ]);
      continue;
    }
    const id = randomUUID();
    evidenceIds.set(r.ref, id);
    evidenceEpisode.set(r.ref, ep);
    ep.evidence.push({ id, ref: r.ref, dto: r.dto });
    acceptedRefs.add(r.ref);
  }

  // Links: resolve evidence (required) + claim (optional); reject on any dangling ref.
  for (const r of results) {
    if (r.kind !== 'evidence-link') continue;
    if (isDuplicateRef(r.ref)) {
      rejectWith(rejections, r, 'evidence-link', dupError);
      continue;
    }
    const evidenceId = evidenceIds.get(r.dto.evidenceRef);
    const ep = evidenceEpisode.get(r.dto.evidenceRef);
    if (!evidenceId || !ep) {
      rejectWith(rejections, r, 'evidence-link', [
        { field: 'evidenceRef', constraint: 'unresolved' },
      ]);
      continue;
    }
    let claimVersionId: string | null = null;
    if (r.dto.claimVersionRef != null) {
      claimVersionId = claimIds.get(r.dto.claimVersionRef) ?? null;
      if (!claimVersionId) {
        rejectWith(rejections, r, 'evidence-link', [
          { field: 'claimVersionRef', constraint: 'unresolved' },
        ]);
        continue;
      }
    }
    ep.links.push({ dto: r.dto, evidenceId, claimVersionId });
    acceptedRefs.add(r.ref);
  }

  return { episodes: [...episodes.values()], acceptedRefs, rejections };
}
