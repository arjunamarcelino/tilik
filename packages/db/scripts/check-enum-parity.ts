/**
 * Enum-parity guard: every @tilik/shared enum must equal its Prisma-generated twin.
 *
 * Two layers, zero `any`:
 *   (a) compile-time — the `Expect<Equal<…>>` aliases below fail `tsc` (hence `typecheck`) on drift;
 *   (b) runtime — `pnpm --filter @tilik/db check:enums` compares the values and exits non-zero on drift.
 *
 * Prisma generates its own enum objects, so hand-matching is not enough — this closes the gap.
 */
import * as Shared from '@tilik/shared';

import * as Db from '../src/generated/prisma/enums';

// (a) Compile-time. `${Enum}` widens a TS enum to its string-literal union — exactly how Prisma 7
//     types its generated enums (`type X = (typeof X)[keyof typeof X]`).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Exported as one tuple so every check is "referenced"; a drift on either side makes an element
// resolve to something other than `true`, which fails `tsc` (and therefore `typecheck`).
export type EnumParityChecks = [
  Expect<Equal<`${Shared.DetectorType}`, Db.DetectorType>>,
  Expect<Equal<`${Shared.Severity}`, Db.Severity>>,
  Expect<Equal<`${Shared.CaseStatus}`, Db.CaseStatus>>,
  Expect<Equal<`${Shared.Verdict}`, Db.Verdict>>,
  Expect<Equal<`${Shared.EvidenceKind}`, Db.EvidenceKind>>,
  Expect<Equal<`${Shared.JobStatus}`, Db.JobStatus>>,
  Expect<Equal<`${Shared.Role}`, Db.Role>>,
  Expect<Equal<`${Shared.ClaimStatus}`, Db.ClaimStatus>>,
  Expect<Equal<`${Shared.ClaimLineType}`, Db.ClaimLineType>>,
];

// (b) Runtime. Explicit typed pairs — no reflective string indexing, no `any`.
const PAIRS = {
  DetectorType: [Shared.DetectorType, Db.DetectorType],
  Severity: [Shared.Severity, Db.Severity],
  CaseStatus: [Shared.CaseStatus, Db.CaseStatus],
  Verdict: [Shared.Verdict, Db.Verdict],
  EvidenceKind: [Shared.EvidenceKind, Db.EvidenceKind],
  JobStatus: [Shared.JobStatus, Db.JobStatus],
  Role: [Shared.Role, Db.Role],
  ClaimStatus: [Shared.ClaimStatus, Db.ClaimStatus],
  ClaimLineType: [Shared.ClaimLineType, Db.ClaimLineType],
} satisfies Record<string, readonly [object, object]>;

let failed = false;
for (const [name, [shared, db]] of Object.entries(PAIRS)) {
  const a = Object.values(shared).sort();
  const b = Object.values(db).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failed = true;
    console.error(
      `✗ ${name} drift:\n  shared = ${JSON.stringify(a)}\n  db     = ${JSON.stringify(b)}`,
    );
  } else {
    console.log(`✓ ${name} (${b.length})`);
  }
}

if (failed) {
  console.error('Enum parity FAILED — schema.prisma and @tilik/shared disagree.');
  process.exit(1);
}
console.log('Enum parity OK.');
