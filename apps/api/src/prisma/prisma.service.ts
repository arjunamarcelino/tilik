import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@tilik/db';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * The API's own Prisma client — NOT @tilik/db's getPrisma(), which binds the OWNER DATABASE_URL. The
 * runtime must connect as the NON-OWNER tilik_app (APP_DATABASE_URL) so the append-only grant actually
 * binds; onModuleInit asserts that at boot and fails fast otherwise. (An ESLint rule also forbids
 * importing getPrisma / PrismaClient anywhere under src except here.)
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('APP_DATABASE_URL', { infer: true }),
        max: 5, // low-traffic internal API; keep well under Postgres max_connections across replicas
        connectionTimeoutMillis: 5000, // fail /health fast instead of hanging if the DB is unreachable
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertNonOwner();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness probe for /health — proves connectivity AND that we are still the non-owner role. */
  async ping(): Promise<boolean> {
    try {
      await this.assertNonOwner();
      return true;
    } catch (err) {
      this.logger.error(err instanceof Error ? err.message : String(err), 'DB ping failed');
      return false;
    }
  }

  private async assertNonOwner(): Promise<void> {
    const rows = await this.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    const role = rows[0]?.current_user;
    if (role !== 'tilik_app') {
      throw new Error(
        `FATAL: API connected to Postgres as '${role ?? 'unknown'}', expected 'tilik_app' — ` +
          'the append-only guarantee would not bind. Check APP_DATABASE_URL.',
      );
    }
  }
}
