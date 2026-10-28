import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { Prisma } from '@tilik/db';

const sha256hex = (s: string): string =>
  createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

/** RFC 8785 (JCS) canonicalization. Throw (not `!`) on undefined — a silent hash would be a tamper hole. */
function jcs(value: unknown): string {
  const s = canonicalize(value);
  if (s === undefined) throw new Error('JCS canonicalization returned undefined');
  return s;
}

/** Normalize money to a fixed 2-dp decimal string BEFORE hashing, so "185000.0" and "185000.00" match. */
const money = (x: string): string => new Prisma.Decimal(x).toFixed(2);

export interface ClaimContentInput {
  inacbgCode: string;
  amount: string;
  patientToken: string;
  lines: Array<{ type: string; code: string; sequence: number; amount?: string | null }>;
}

/**
 * contentHash for a ClaimVersion — the "same content" key for repeat-billing / cloning detection.
 * Deliberately EXCLUDES claimNo/version/submittedAt/status/ids and the free-text `description`, so two
 * substantively identical claims collide on the hash. Field set is a documented detection-semantics
 * decision (shared with the detector via the golden fixture).
 */
export function claimVersionContentHash(input: ClaimContentInput): string {
  const content = {
    inacbgCode: input.inacbgCode,
    amount: money(input.amount),
    patientToken: input.patientToken,
    lines: [...input.lines]
      .sort((a, b) => a.sequence - b.sequence) // JCS preserves array order → sort first
      .map((l) => ({
        type: l.type,
        code: l.code,
        sequence: l.sequence,
        amount: l.amount == null ? null : money(l.amount),
      })),
  };
  return sha256hex(jcs(content));
}

export interface EvidencePayloadInput {
  kind: string;
  source: string | null;
  capturedAt: string;
  payload: unknown;
}

/** contentHash for payload-backed evidence. File-backed evidence instead hashes the exact stored bytes. */
export function evidencePayloadContentHash(input: EvidencePayloadInput): string {
  return sha256hex(
    jcs({
      kind: input.kind,
      source: input.source,
      capturedAt: input.capturedAt,
      payload: input.payload,
    }),
  );
}
