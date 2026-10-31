import type { FindingReasons } from '@tilik/shared/contracts';

/**
 * Finding.reasons is authored by the Python detector — a cross-service, cross-language boundary — so it
 * must be parsed defensively, NOT read with the `fromJsonValue<T>()` cast (whose doc restricts it to JSON
 * this process wrote). The guard never throws: a malformed shape degrades to an empty result so a single
 * bad finding can't 500 the whole case read.
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
