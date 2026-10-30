// Preload (via NODE_OPTIONS=--import) so the single repo-root .env is loaded into process.env for EVERY
// Next process — the CLI, the config, and the render workers alike. next.config-time loading alone does
// not reach the workers that run Server Components, so a server-side read of NEXT_PUBLIC_API_URL there
// would be undefined. Runs before any application module. Mirrors the API's load-env.ts.
//
// NOTE (review P3-5): this is wired into the pnpm dev/build/start scripts, NOT into `next` itself. An
// out-of-band `next` invocation runs without it → apiBase() throws a clear "NEXT_PUBLIC_API_URL not set"
// (degrades loudly, never silently). Run the app through the package scripts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env'; // CommonJS — default import, then destructure

const { loadEnvConfig } = nextEnv;
const dir = dirname(fileURLToPath(import.meta.url));

// Snapshot the ambient (shell) env so we only prune keys THIS load adds from the root .env.
const ambient = new Set(Object.keys(process.env));

// The `dev` flag only selects .env.development/.env.production variant files; the repo uses a single
// root .env with no variants, so the value is inert here (review P3-4). Pass a best-effort default.
loadEnvConfig(resolve(dir, '../..'), process.env.NODE_ENV !== 'production');

// Least-privilege (review P2-1): the web tier needs ONLY NEXT_PUBLIC_API_URL (+ WEB_PORT). The root .env
// also carries JWT_SECRET, the owner DATABASE_URL, MinIO + HMAC keys, and SEED_* passwords — none of which
// the portal uses. Drop every key this load introduced that isn't web-scoped, so those secrets never sit
// in the (internet-facing) Next process's environment. NEXT_PUBLIC_* stays (NEXT_PUBLIC_API_URL).
const WEB_ALLOW = new Set(['NEXT_PUBLIC_API_URL', 'WEB_PORT', 'NODE_ENV']);
for (const key of Object.keys(process.env)) {
  if (!ambient.has(key) && !WEB_ALLOW.has(key) && !key.startsWith('NEXT_PUBLIC_')) {
    delete process.env[key];
  }
}
