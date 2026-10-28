import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { EnvironmentVariables } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  configureApp(app);
  app.use(helmet()); // security headers; Caddy owns HSTS in production (Prompt 14)
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: false });
  app.enableShutdownHooks(); // required so PrismaService.onModuleDestroy ($disconnect) fires on SIGTERM

  await app.listen(config.get('API_PORT', { infer: true }));
}

void bootstrap();
