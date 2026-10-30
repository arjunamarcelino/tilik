// Cross-service outbox contract check — the TS half of test-vectors/outbox-contract.json.
//
// The Python detector (services/detector/tests/test_outbox_contract.py) asserts the SAME fixture, so a
// rename of the job type on either side (which would make the worker poll for a type that is never
// enqueued — a silent, zero-error stall) trips a test instead of silently halting detection.
// Runnable without a test runner: `pnpm --filter @tilik/api test:contract`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIT_ACTION, OUTBOX_JOB_TYPE } from '@tilik/shared/constants';

interface OutboxContract {
  jobType: string;
  payload: { v: number; keys: string[] };
}

interface AuditContract {
  actions: Record<string, string>;
}

// apps/api is CommonJS — use __dirname, consistent with test/tokenize.vectors.ts.
const vectors = resolve(__dirname, '..', '..', '..', 'test-vectors');
const contract = JSON.parse(
  readFileSync(resolve(vectors, 'outbox-contract.json'), 'utf8'),
) as OutboxContract;

assert.equal(
  OUTBOX_JOB_TYPE.DETECT_EPISODE,
  contract.jobType,
  'OUTBOX_JOB_TYPE.DETECT_EPISODE drifted from the shared outbox contract',
);
assert.equal(contract.payload.v, 1, 'outbox payload version must be 1');

console.log('✓ outbox contract matches @tilik/shared/constants');

// Audit-action contract: the detector writes these actions and the case/audit UI reads them, so they are
// pinned both sides. Assert EVERY action in the fixture matches AUDIT_ACTION by name+value — so a new (or
// renamed) boundary-crossing action added to the fixture can't drift from the shared constant — and that
// DETECT specifically is pinned (it must never silently drop from the contract).
const audit = JSON.parse(
  readFileSync(resolve(vectors, 'audit-contract.json'), 'utf8'),
) as AuditContract;

const actions = AUDIT_ACTION as Record<string, string>;
for (const [key, value] of Object.entries(audit.actions)) {
  assert.equal(
    actions[key],
    value,
    `audit action ${key} drifted from or is missing in @tilik/shared/constants AUDIT_ACTION`,
  );
}
assert.ok(
  'DETECT' in audit.actions,
  'audit contract must pin DETECT (the detector-written action)',
);

console.log('✓ audit-action contract matches @tilik/shared/constants');
