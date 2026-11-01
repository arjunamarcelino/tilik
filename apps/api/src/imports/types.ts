import type { RecordType, Rejection } from '@tilik/shared/contracts';
import type {
  ClaimVersionDto,
  EpisodeDto,
  EvidenceLinkDto,
  EvidenceRecordDto,
} from './dto/bundle-records.dto';

// The import RESPONSE DTOs (RecordType / FieldError / Rejection / ImportResult) are the single source of
// truth in @tilik/shared/contracts, pinned web-side with `satisfies z.ZodType<…>`. Re-exported here so
// existing importers (imports.service.ts, imports.controller.ts) keep their `./types` import path.
export type { FieldError, ImportResult, RecordType, Rejection } from '@tilik/shared/contracts';

/** One incoming bundle record, tagged with its source file + a batch-global position, pre-redaction. */
export interface RawRecord {
  recordType: RecordType;
  position: number;
  ref: string;
  raw: Record<string, unknown>;
}

/** Per-record outcome. Discriminated by `kind` so the resolved DTO type is recovered without `any`. */
export type RowResult =
  | { kind: 'episode'; position: number; ref: string; dto: EpisodeDto }
  | { kind: 'claim-version'; position: number; ref: string; dto: ClaimVersionDto }
  | { kind: 'evidence-record'; position: number; ref: string; dto: EvidenceRecordDto }
  | { kind: 'evidence-link'; position: number; ref: string; dto: EvidenceLinkDto }
  | ({ kind: 'rejected' } & Rejection);
