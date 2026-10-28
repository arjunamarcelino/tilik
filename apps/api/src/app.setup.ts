import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Global wiring shared by main.ts and (later) e2e tests, so production and test behaviour can't drift.
 * createNestApplication() does NOT replay useGlobalX() calls, so anything applied here must live here.
 */
export function configureApp(app: INestApplication): void {
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
}
