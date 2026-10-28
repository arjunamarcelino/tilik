import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer auto-loads .env. Load the single repo-root .env before defineConfig() below
// evaluates env('DATABASE_URL'). __dirname = packages/db (this package is CommonJS — no
// "type":"module"), so the repo root is two levels up.
loadEnv({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Prisma 7 moved the connection URL out of schema.prisma. Migrate reads it here;
  // PrismaClient connects via the pg driver adapter (see src/index.ts).
  datasource: { url: env('DATABASE_URL') },
  // Seeding (`migrations.seed`) is wired in a later prompt, when auth needs a demo user.
});
