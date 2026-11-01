// Preload (via NODE_OPTIONS=--import) so the single repo-root .env is loaded into process.env for EVERY
// Next process — the CLI, the config, and the render workers alike (NODE_OPTIONS propagates to the worker
// subprocesses, so each re-runs this). next.config-time loading alone does not reach the workers that run
// Server Components, so a server-side read of NEXT_PUBLIC_API_URL there would be undefined. Runs before any
// application module. Mirrors the API's load-env.ts.
//
// NOTE (review P3-5): this is wired into the pnpm dev/build/start scripts, NOT into `next` itself. An
// out-of-band `next` invocation runs without it → apiBase() throws a clear "NEXT_PUBLIC_API_URL not set"
// (degrades loudly, never silently). Run the app through the package scripts.
//
// WHY the Node built-in loader, not @next/env's loadEnvConfig (Prompt 14): loadEnvConfig MEMOIZES the
// loaded-file list in @next/env's module state. `next build` reuses that memo, so with output:'standalone'
// its finalize step tries to copy `join(appDir, '.env')` = apps/web/.env — a file that doesn't exist here
// (the .env lives at the repo root) → ENOENT, build fails. process.loadEnvFile populates process.env
// directly and leaves @next/env untouched, so Next discovers its own (empty) env set and copies no phantom
// .env. It is also a Node core API — no module to trace — so the standalone runtime's `--import` preload
// needs nothing in node_modules. Same no-override semantics as dotenv: a shell-set var always wins.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Snapshot the ambient (shell / container-injected) env so we only prune keys THIS load adds from .env.
const ambient = new Set(Object.keys(process.env));

// __dirname = apps/web, so the single root .env is two levels up. Absent in the prod container (env is
// injected directly) — existsSync makes that a clean no-op; real injected vars already sit in process.env.
const envPath = resolve(dir, '..', '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Least-privilege (review P2-1): the web tier needs ONLY NEXT_PUBLIC_API_URL (+ WEB_PORT). The root .env
// also carries JWT_SECRET, the owner DATABASE_URL, MinIO + HMAC keys, and SEED_* passwords — none of which
// the portal uses. Drop every key this load introduced that isn't web-scoped, so those secrets never sit
// in the (internet-facing) Next process's environment. NEXT_PUBLIC_* stays (NEXT_PUBLIC_API_URL).
// NODE_ENV is deliberately NOT allow-listed: Next owns it (production for `build`/`start`, development for
// `dev`). The root .env carries NODE_ENV=development (for the API); letting it survive here would force a
// dev React build during `next build` → a prerender crash. Pruning it hands control back to Next.
const WEB_ALLOW = new Set(['NEXT_PUBLIC_API_URL', 'WEB_PORT']);
for (const key of Object.keys(process.env)) {
  if (!ambient.has(key) && !WEB_ALLOW.has(key) && !key.startsWith('NEXT_PUBLIC_')) {
    delete process.env[key];
  }
}
