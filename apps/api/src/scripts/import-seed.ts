// One-command demo seed: reads data/synthetic/out/ and drives the REAL import endpoint over HTTP, so the
// demo exercises auth → RBAC → multipart → idempotency exactly as a client would.
//
//   pnpm --filter @tilik/api import:seed
//
// Requires: the API running (NODE_ENV/CORS_ORIGIN/JWT_SECRET/PATIENT_TOKEN_HMAC_KEY/MINIO_* set), infra up
// (postgres + minio), and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD set (the API seeds that user on boot; the
// CLI logs in as it). The Idempotency-Key is derived from the manifest bytes, so a re-run REPLAYS.
import { config as loadDotenv } from 'dotenv';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// apps/api is CommonJS (no "type":"module") — use __dirname, not import.meta. src/scripts and dist/scripts
// are both four levels under the repo root.
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
loadDotenv({ path: resolve(repoRoot, '.env') });

const bundleDir = process.env.BUNDLE_DIR ?? resolve(repoRoot, 'data', 'synthetic', 'out');
// SEED_API_BASE lets the containerised seed one-shot (Prompt 14) target the api over the Compose network
// (http://api:3001); unset in local dev it falls back to localhost:API_PORT (the single-host default).
const apiBase = process.env.SEED_API_BASE ?? `http://localhost:${process.env.API_PORT ?? '3001'}`;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

function die(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const readJson = (name: string): unknown[] => {
  try {
    return JSON.parse(readFileSync(resolve(bundleDir, name), 'utf8')) as unknown[];
  } catch {
    return die(
      `Cannot read ${name} in ${bundleDir} — run the synthetic generator first (data/synthetic).`,
    );
  }
};

async function main(): Promise<void> {
  if (!email || !password) {
    die('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (the admin the API seeds on boot).');
  }

  // Build the manifest (labels are NOT read — detector ground truth must never be imported).
  const manifest = {
    episodes: readJson('episodes.json'),
    claimVersions: readJson('claim-versions.json'),
    evidenceRecords: readJson('evidence-records.json'),
    evidenceLinks: readJson('evidence-links.json'),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const idempotencyKey = `seed:${createHash('sha256').update(manifestBytes).digest('hex')}`;

  // Log in.
  let token: string;
  try {
    const res = await fetch(`${apiBase}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok)
      die(`Login failed (${res.status}). Check SEED_ADMIN_* and that the user is seeded.`);
    token = ((await res.json()) as { accessToken: string }).accessToken;
  } catch (err) {
    if (err instanceof Error && 'cause' in err) {
      die(
        `Cannot reach the API at ${apiBase} — start it first: pnpm --filter @tilik/api start:dev`,
      );
    }
    throw err;
  }

  // Assemble multipart: the manifest part + one file part per file-backed evidence (fieldname = its ref).
  const form = new FormData();
  form.append('manifest', new Blob([manifestBytes], { type: 'application/json' }), 'manifest.json');
  for (const ev of manifest.evidenceRecords as Array<{ ref?: string; file?: string | null }>) {
    if (typeof ev.ref !== 'string' || typeof ev.file !== 'string') continue;
    const bytes = readFileSync(resolve(bundleDir, ev.file));
    form.append(ev.ref, new Blob([bytes]), ev.file.split('/').pop() ?? ev.ref);
  }

  // POST the import.
  const res = await fetch(`${apiBase}/v1/imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    body: form,
  });
  const body = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (res.status >= 400) process.exit(1);
}

void main();
