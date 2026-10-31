import './load-env'; // MUST be first: populates process.env before any decorator below evaluates.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CasesModule } from './cases/cases.module';
import { validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({
  imports: [
    // load-env.ts already loaded the root .env into process.env; here we only validate the API's subset.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          // Accept an inbound correlation id only if it's a well-formed UUID (lets a trusted caller stitch
          // web->api traces) — otherwise mint one. Never reflect an arbitrary client-supplied string.
          const header = req.headers['x-correlation-id'];
          const candidate = Array.isArray(header) ? header[0] : header;
          const id = candidate && UUID_RE.test(candidate) ? candidate : randomUUID();
          res.setHeader('x-correlation-id', id);
          return id;
        },
      },
    }),
    // In-memory, per-instance store. NOTE(Prompt 14): use a Redis ThrottlerStorage for multi-instance so
    // the per-credential login limit (auth.controller) isn't multiplied by the replica count.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: seconds(60), limit: 100 }] }),
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    HealthModule,
    ImportsModule,
    CasesModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard populates req.user before RolesGuard reads it; ThrottlerGuard last.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
