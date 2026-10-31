import { IsBoolean, IsOptional } from 'class-validator';

/**
 * `POST /v1/cases/:id/summary` body (Prompt 13). The only field is an optional `regenerate` flag.
 *
 * `regenerate` is nearly behaviour-free: the endpoint overwrites `Case.summary` unconditionally
 * (last-writer-wins), so the flag does NOT gate the overwrite or short-circuit when a summary already
 * exists — it only records intent in the audit metadata (`regenerated: true`). The web sends a JSON body
 * (`{ regenerate }`), so no string→boolean coercion is needed (unlike a query param).
 */
export class GenerateSummaryDto {
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}
