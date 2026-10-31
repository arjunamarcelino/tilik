import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Verdict } from '@tilik/shared';
import { MAX_RATIONALE_LENGTH } from '@tilik/shared/constants';

/**
 * `POST /v1/cases/:id/decision` body. The reviewer issues a verdict + a required rationale.
 *
 * `verdict` is typed as the enum's string-literal union (`${Verdict}`) and validated with
 * `@IsIn(Object.values(Verdict))` — the repo convention (see list-cases.query.ts); the value is directly
 * assignable to Prisma's structural enum at the persistence edge (no cast). `rationale` is trimmed BEFORE
 * validation (the global ValidationPipe runs `transform: true` → `plainToInstance` applies `@Transform`
 * first), so `@MinLength(1)` rejects a whitespace-only string. `@MaxLength(2000)` bounds the value well
 * under the AuditEvent metadata CHECK (octet_length < 1 MiB) — a violation inside the decide transaction
 * would roll the whole decision back, so the bound belongs here, before the value is ever persisted.
 */
export class DecideCaseDto {
  @IsIn(Object.values(Verdict))
  verdict!: `${Verdict}`;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'rationale is required' })
  @MaxLength(MAX_RATIONALE_LENGTH)
  rationale!: string;
}
