/**
 * Cross-service API response DTOs — the single source of truth for the shapes the NestJS API returns
 * and the Next.js portal consumes. Reachable only via the "@tilik/shared/contracts" subpath (kept off
 * the root barrel, like ./constants, so the enum-parity guard's barrel stays enum-only).
 *
 * These are **response contracts**, distinct from Prisma persistence models (which stay in @tilik/db).
 * Types only — no runtime, no dependencies. The web app pins them at the trust boundary with zod
 * schemas annotated `satisfies z.ZodType<…>`, so a schema that drifts from these types fails to compile.
 */
import type { CaseStatus, Role, Severity } from './enums';

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
