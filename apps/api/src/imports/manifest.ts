import type { RawRecord } from './types';

/**
 * The JSON manifest part of the multipart upload — the structured bundle minus any file bytes (those
 * arrive as separate file parts) and minus manifest.labels (detector ground truth, never imported).
 */
export interface ImportManifest {
  episodes: Array<Record<string, unknown>>;
  claimVersions: Array<Record<string, unknown>>;
  evidenceRecords: Array<Record<string, unknown>>;
  evidenceLinks: Array<Record<string, unknown>>;
}

const SECTIONS = [
  ['episodes', 'episode'],
  ['claimVersions', 'claim-version'],
  ['evidenceRecords', 'evidence-record'],
  ['evidenceLinks', 'evidence-link'],
] as const;

/** Structural check: the manifest must be an object whose four sections are arrays. */
export function isImportManifest(value: unknown): value is ImportManifest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return SECTIONS.every(([key]) => Array.isArray(obj[key]));
}

/** Flatten the manifest into records tagged with a BATCH-GLOBAL position, in dependency order (episodes first). */
export function flattenManifest(manifest: ImportManifest): RawRecord[] {
  const out: RawRecord[] = [];
  let position = 0; // global across all sections, so rejection ordering is stable and unambiguous
  for (const [key, recordType] of SECTIONS) {
    for (const raw of manifest[key]) {
      const ref = typeof raw.ref === 'string' ? raw.ref : `${recordType}:${position}`;
      out.push({ recordType, position, ref, raw });
      position++;
    }
  }
  return out;
}
