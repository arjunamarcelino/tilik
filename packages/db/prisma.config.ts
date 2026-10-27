import 'dotenv/config'; // Prisma 7 no longer auto-loads .env; load it explicitly for the CLI.
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Prisma 7 moved the connection URL out of schema.prisma. Migrate reads it here;
  // PrismaClient connects via the pg driver adapter (see src/index.ts).
  datasource: { url: env('DATABASE_URL') },
  // Seeding (`migrations.seed`) is wired in a later prompt, when auth needs a demo user.
});
