import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { EnvironmentVariables } from './config/env.validation';

/**
 * Global wiring shared by main.ts and (later) e2e tests, so production and test behaviour can't drift.
 * createNestApplication() does NOT replay useGlobalX()/use()/enableCors() calls, so everything applied
 * imperatively at bootstrap must live here.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // /v1 for everything except the infra health probe, which stays at a stable, unversioned /health.
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties with no DTO decorator (anti mass-assignment)
      forbidNonWhitelisted: true, // 400 on unexpected properties
      transform: true, // instantiate DTOs + coerce path/query primitives
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(helmet()); // security headers; Caddy owns HSTS in production (Prompt 14)
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: false });
  app.enableShutdownHooks(); // required so PrismaService.onModuleDestroy ($disconnect) fires on SIGTERM
}
