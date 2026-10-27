/**
 * Compile-time enum-parity guard. Fails `tsc` (hence `pnpm --filter @tilik/db typecheck`) if:
 *   (1) either side has a string enum the other lacks (by name), or
 *   (2) any shared enum's values differ from its Prisma-generated twin.
 *
 * There is NO runtime: this file is only type-checked, never executed — so a newly added enum
 * that someone forgets to wire up still fails the build via the completeness check below.
 * Assumes string enums on both sides (the project's convention).
 */
import * as Shared from '@tilik/shared';

import * as Db from '../src/generated/prisma/enums';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** String-value union of an enum object (a TS enum or a Prisma `as const` object). */
type Values<E> = `${E[keyof E] & string}`;

/** Names of the string-enum exports in a module namespace. */
type EnumNames<M> = { [K in keyof M]: M[K] extends Record<string, string> ? K : never }[keyof M];

type SharedEnums = EnumNames<typeof Shared>;
type DbEnums = EnumNames<typeof Db>;

/** Per-shared-enum value equality against the Prisma twin of the same name. */
type ValueParity = {
  [K in SharedEnums]: Equal<Values<(typeof Shared)[K]>, Values<(typeof Db)[K & DbEnums]>>;
};

// Exported so the assertions are "used"; each line fails `tsc` if its invariant is violated.
export type EnumParityAssertions = [
  Expect<Equal<Exclude<SharedEnums, DbEnums>, never>>, // no shared enum missing on the Prisma side
  Expect<Equal<Exclude<DbEnums, SharedEnums>, never>>, // no Prisma enum missing on the shared side
  Expect<Equal<ValueParity[SharedEnums], true>>, // every enum's values match exactly
];
