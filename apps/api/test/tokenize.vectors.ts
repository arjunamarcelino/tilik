// Cross-language golden-vector check for the patient-token + contentHash spec.
//
// Recomputes each vector with the real import functions and asserts it matches the committed fixture
// (test-vectors/tokenization.vectors.json). The Python detector (Prompt 07) asserts the SAME fixture, so
// any drift on either side is caught. Runnable without a test runner: `pnpm --filter @tilik/api test:vectors`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claimVersionContentHash, type ClaimContentInput } from '../src/imports/canonical';
import { patientToken } from '../src/imports/tokenize';

interface Vectors {
  hmacKey: string;
  patientTokens: Array<{ patientRef: string; expected: string }>;
  contentHashes: Array<{ input: ClaimContentInput; expected: string }>;
}

// apps/api is CommonJS (no "type":"module") — use __dirname, consistent with src/scripts/import-seed.ts.
const fixturePath = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'test-vectors',
  'tokenization.vectors.json',
);
const vectors = JSON.parse(readFileSync(fixturePath, 'utf8')) as Vectors;

let checked = 0;
for (const v of vectors.patientTokens) {
  assert.equal(
    patientToken(v.patientRef, vectors.hmacKey),
    v.expected,
    `patientToken(${v.patientRef})`,
  );
  checked++;
}
for (const v of vectors.contentHashes) {
  assert.equal(claimVersionContentHash(v.input), v.expected, `contentHash(${v.input.inacbgCode})`);
  checked++;
}

console.log(`✓ ${checked} tokenization/contentHash golden vectors match`);
