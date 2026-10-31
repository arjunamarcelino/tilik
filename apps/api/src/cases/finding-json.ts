import type { FindingReasons } from '@tilik/shared/contracts';

/**
 * Finding.reasons / evidenceRefs are authored by the Python detector — a cross-service, cross-language
 * boundary — so they must be parsed defensively, NOT read with the `fromJsonValue<T>()` cast (whose doc
 * restricts it to JSON this process wrote). These guards never throw: a malformed shape degrades to an
 * empty result so a single bad finding can't 500 the whole case read.
 */

export function parseReasons(value: unknown): FindingReasons {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const messages = Array.isArray(obj.messages)
      ? obj.messages.filter((m): m is string => typeof m === 'string')
      : [];
    const detail =
      typeof obj.detail === 'object' && obj.detail !== null && !Array.isArray(obj.detail)
        ? (obj.detail as Record<string, unknown>)
        : {};
    return { messages, detail };
  }
  return { messages: [], detail: { _parseError: true } };
}

/** Finding.evidenceRefs is a JSON array of EvidenceRecord id strings. */
export function parseEvidenceRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
