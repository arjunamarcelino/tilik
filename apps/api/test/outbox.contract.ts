// Cross-service outbox contract check — the TS half of test-vectors/outbox-contract.json.
//
// The Python detector (services/detector/tests/test_outbox_contract.py) asserts the SAME fixture, so a
// rename of the job type on either side (which would make the worker poll for a type that is never
// enqueued — a silent, zero-error stall) trips a test instead of silently halting detection.
// Runnable without a test runner: `pnpm --filter @tilik/api test:contract`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUTBOX_JOB_TYPE } from '@tilik/shared/constants';

interface OutboxContract {
  jobType: string;
  payload: { v: number; keys: string[] };
}

// apps/api is CommonJS — use __dirname, consistent with test/tokenize.vectors.ts.
const fixturePath = resolve(__dirname, '..', '..', '..', 'test-vectors', 'outbox-contract.json');
const contract = JSON.parse(readFileSync(fixturePath, 'utf8')) as OutboxContract;

assert.equal(
  OUTBOX_JOB_TYPE.DETECT_EPISODE,
  contract.jobType,
  'OUTBOX_JOB_TYPE.DETECT_EPISODE drifted from the shared outbox contract',
);
assert.equal(contract.payload.v, 1, 'outbox payload version must be 1');

console.log('✓ outbox contract matches @tilik/shared/constants');
