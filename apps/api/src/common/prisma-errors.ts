import { Prisma } from '@tilik/db';

/** True for a Prisma unique-constraint violation (P2002) — the idempotency/seed-race primitive. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
