import { z } from 'zod';
import { Role } from '@tilik/shared';
import type { CaseStats, Me } from '@tilik/shared/contracts';

/**
 * Runtime schemas for the API responses, pinned to the shared contracts via `satisfies z.ZodType<…>` —
 * a schema that drifts from the contract type fails to compile. `schema.parse()` turns silent response
 * drift into a loud failure at the trust boundary (no `as` casts).
 */
const count = z.number().int().nonnegative();

export const MeSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(Role),
}) satisfies z.ZodType<Me>;

export const CaseStatsSchema = z.object({
  total: count,
  open: count,
  byStatus: z.object({
    OPEN: count,
    IN_REVIEW: count,
    PENDING: count,
    ESCALATED: count,
    CLOSED: count,
  }),
  bySeverity: z.object({
    LOW: count,
    MEDIUM: count,
    HIGH: count,
  }),
}) satisfies z.ZodType<CaseStats>;
