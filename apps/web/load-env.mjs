// Preload (via NODE_OPTIONS=--import) so the single repo-root .env is loaded into process.env for EVERY
// Next process — the CLI, the config, and the render workers alike. next.config-time loading alone does
// not reach the workers that run Server Components, so a server-side read of NEXT_PUBLIC_API_URL there
// would be undefined. Runs before any application module. Mirrors the API's load-env.ts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env'; // CommonJS — default import, then destructure

const { loadEnvConfig } = nextEnv;
const dir = dirname(fileURLToPath(import.meta.url));
loadEnvConfig(resolve(dir, '../..'), process.env.NODE_ENV !== 'production');
