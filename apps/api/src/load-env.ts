import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Prisma 7 / Node do not auto-load .env, and @nestjs/config evaluates ConfigModule's metadata only during
// Nest bootstrap — too late for the compile-time `process.env` reads in app.module.ts (e.g. the dev-module
// gate). Load the single repo-root .env here as a side effect, imported FIRST so it runs before any module
// decorator evaluates. __dirname = apps/api/{src,dist} (one level under the package), so the repo root is
// three levels up for both ts-node dev and the compiled build. Mirrors packages/db/prisma.config.ts.
loadDotenv({ path: resolve(__dirname, '../../../.env') });
