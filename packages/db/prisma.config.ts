// Prisma 7 no longer auto-loads .env. Load the single repo-root .env explicitly for the CLI.
// __dirname = packages/db; the repo root is two levels up (this package is CommonJS — no
// "type":"module" — so __dirname is defined). Must run before env() is evaluated below.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../.env') });

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Prisma 7 moved the connection URL out of schema.prisma. Migrate reads it here;
  // PrismaClient connects via the pg driver adapter (see src/index.ts).
  datasource: { url: env('DATABASE_URL') },
  // Seeding (`migrations.seed`) is wired in a later prompt, when auth needs a demo user.
});
