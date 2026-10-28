import { Prisma } from '@tilik/db';

// Prisma's InputJsonValue requires an index signature that our concrete interfaces (FieldError[], DTOs) lack,
// so writing them needs a cast. These two helpers name and localise that unavoidable friction.

/** Cast a JSON-shaped value to Prisma's write type. The value MUST be plain JSON (no class methods, no cycles). */
export const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

/** Read a stored Json column back as a known shape. UNVALIDATED — only use where this process wrote it. */
export const fromJsonValue = <T>(value: unknown): T => value as T;
