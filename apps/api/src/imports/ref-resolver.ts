import { randomUUID } from 'node:crypto';
import type { StoredObject } from '../minio/minio.service';
import type {
  ClaimVersionDto,
  EpisodeDto,
  EvidenceLinkDto,
  EvidenceRecordDto,
} from './dto/bundle-records.dto';
import type { FieldError, RecordType, RowResult } from './types';

export interface ResolvedClaim {
  id: string;
  dto: ClaimVersionDto;
}
export interface ResolvedEvidence {
  id: string;
  dto: EvidenceRecordDto;
  object: StoredObject | null; // set for file-backed evidence
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

export interface Rejection {
  position: number;
  recordType: RecordType;
  ref: string;
  errors: FieldError[];
}

export interface ResolveResult {
  episodes: ResolvedEpisode[];
  acceptedRefs: Set<string>;
  rejections: Rejection[];
}

const reject = (
  list: Rejection[],
  r: { position: number; ref: string },
  recordType: RecordType,
  field: string,
  constraint: string,
): void =>
  void list.push({ position: r.position, ref: r.ref, recordType, errors: [{ field, constraint }] });

/**
 * Second pass over validated records: mint ids, resolve surrogate refs to them, and reject records whose
 * parents/targets were rejected or are absent (dangling) — a dangling child never fails its episode's
 * transaction, it's just counted as rejected. Pure (ids from randomUUID; no I/O). No version lineage
 * (D8: every bundle claim is version=1 into an empty DB; isCurrent uses the schema default).
 */
export function resolve(results: RowResult[], files: Map<string, StoredObject>): ResolveResult {
  const rejections: Rejection[] = [];
  const acceptedRefs = new Set<string>();

  // DTO-level rejections carry straight through.
  for (const r of results) {
    if (r.kind === 'rejected') {
      rejections.push({
        position: r.position,
        ref: r.ref,
        recordType: r.recordType,
        errors: r.errors,
      });
    }
  }

  // Episodes: mint ids.
  const episodes = new Map<string, ResolvedEpisode>(); // ref → resolved
  for (const r of results) {
    if (r.kind !== 'episode') continue;
    const id = randomUUID();
    episodes.set(r.ref, { id, dto: r.dto, claims: [], evidence: [], links: [] });
    acceptedRefs.add(r.ref);
  }

  // Claims: attach to their episode or reject (dangling episodeRef).
  const claimIds = new Map<string, string>(); // ref → id
  for (const r of results) {
    if (r.kind !== 'claim-version') continue;
    const ep = episodes.get(r.dto.episodeRef);
    if (!ep) {
      reject(rejections, r, 'claim-version', 'episodeRef', 'unresolved');
      continue;
    }
    const id = randomUUID();
    claimIds.set(r.ref, id);
    ep.claims.push({ id, dto: r.dto });
    acceptedRefs.add(r.ref);
  }

  // Evidence: attach to its episode; file-backed evidence needs its uploaded object.
  const evidenceEpisode = new Map<string, string>(); // evidence ref → episode ref
  const evidenceIds = new Map<string, string>(); // evidence ref → id
  for (const r of results) {
    if (r.kind !== 'evidence-record') continue;
    const ep = episodes.get(r.dto.episodeRef);
    if (!ep) {
      reject(rejections, r, 'evidence-record', 'episodeRef', 'unresolved');
      continue;
    }
    let object: StoredObject | null = null;
    if (typeof r.dto.file === 'string' && r.dto.file.length > 0) {
      object = files.get(r.ref) ?? null;
      if (!object) {
        reject(rejections, r, 'evidence-record', 'file', 'missingUpload');
        continue;
      }
    }
    const id = randomUUID();
    evidenceIds.set(r.ref, id);
    evidenceEpisode.set(r.ref, r.dto.episodeRef);
    ep.evidence.push({ id, dto: r.dto, object });
    acceptedRefs.add(r.ref);
  }

  // Links: resolve evidence (required) + claim (optional); reject on any dangling ref.
  for (const r of results) {
    if (r.kind !== 'evidence-link') continue;
    const evidenceId = evidenceIds.get(r.dto.evidenceRef);
    if (!evidenceId) {
      reject(rejections, r, 'evidence-link', 'evidenceRef', 'unresolved');
      continue;
    }
    let claimVersionId: string | null = null;
    if (r.dto.claimVersionRef != null) {
      claimVersionId = claimIds.get(r.dto.claimVersionRef) ?? null;
      if (!claimVersionId) {
        reject(rejections, r, 'evidence-link', 'claimVersionRef', 'unresolved');
        continue;
      }
    }
    const ep = episodes.get(evidenceEpisode.get(r.dto.evidenceRef)!)!;
    ep.links.push({ dto: r.dto, evidenceId, claimVersionId });
    acceptedRefs.add(r.ref);
  }

  return { episodes: [...episodes.values()], acceptedRefs, rejections };
}
