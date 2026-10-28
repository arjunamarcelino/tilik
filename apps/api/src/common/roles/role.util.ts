import { Role } from '@tilik/shared';
import type { Role as PrismaRole } from '@tilik/db';

/**
 * Convert a persistence-edge Prisma role (a structural string-literal union) into the domain `Role`
 * (a nominal TS enum). They share values but are distinct types, so a direct `===`/assignment does not
 * typecheck. Indexing the enum object by the union member is total and cast-free — and if the two enums
 * ever drift, this stops compiling (a free parity check at the type level).
 */
export const toDomainRole = (role: PrismaRole): Role => Role[role];
