import type {
  ClaimVersionDto,
  EpisodeDto,
  EvidenceLinkDto,
  EvidenceRecordDto,
} from './dto/bundle-records.dto';

export type RecordType = 'episode' | 'claim-version' | 'evidence-record' | 'evidence-link';

/** One incoming bundle record, tagged with its source file + a batch-global position, pre-redaction. */
export interface RawRecord {
  recordType: RecordType;
  position: number;
  ref: string;
  raw: Record<string, unknown>;
}

/** A per-field validation/linkage failure. NEVER carries the offending value (no PII echo). */
export interface FieldError {
  field: string;
  constraint: string;
}

/** A rejected record (DTO-invalid, duplicate, dangling ref, or missing upload). Single shared shape. */
export interface Rejection {
  position: number;
  recordType: RecordType;
  ref: string;
  errors: FieldError[];
}

/** Per-record outcome. Discriminated by `kind` so the resolved DTO type is recovered without `any`. */
export type RowResult =
  | { kind: 'episode'; position: number; ref: string; dto: EpisodeDto }
  | { kind: 'claim-version'; position: number; ref: string; dto: ClaimVersionDto }
  | { kind: 'evidence-record'; position: number; ref: string; dto: EvidenceRecordDto }
  | { kind: 'evidence-link'; position: number; ref: string; dto: EvidenceLinkDto }
  | ({ kind: 'rejected' } & Rejection);

/** HTTP response body for POST /v1/imports and GET /v1/imports/:id. */
export interface ImportResult {
  batchId: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'PARTIAL';
  summary: { received: number; accepted: number; rejected: number };
  rejected: Rejection[];
}
