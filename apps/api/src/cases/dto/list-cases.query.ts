import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CaseStatus, DetectorType, Severity } from '@tilik/shared';

/**
 * `GET /v1/cases` filters + pagination. No sort params — the list order is fixed
 * (severity DESC, createdAt DESC, id DESC); reviewers triage by filtering, not re-sorting.
 *
 * Fields are typed as the enum's string-literal union (`${Enum}`) and validated with
 * `@IsIn(Object.values(Enum))` — the repo convention (see bundle-records.dto.ts). The resulting value is
 * directly assignable to Prisma's structural enum filter at the persistence edge (no cast), and the
 * enum-parity guard keeps the two definitions equal. Numeric params need `@Type(() => Number)` because the
 * global ValidationPipe runs with `enableImplicitConversion: false`, so `?page=2` arrives as a string.
 * Defaults are applied in the service (not as property initializers, which are brittle under `whitelist`).
 */
export class ListCasesQuery {
  @IsOptional()
  @IsIn(Object.values(CaseStatus))
  status?: `${CaseStatus}`;

  @IsOptional()
  @IsIn(Object.values(Severity))
  severity?: `${Severity}`;

  @IsOptional()
  @IsIn(Object.values(DetectorType))
  detector?: `${DetectorType}`;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
