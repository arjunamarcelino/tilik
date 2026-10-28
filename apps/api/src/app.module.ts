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
import { validate } from './config/env.validation';
import { DevModule } from './dev/dev.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // load-env.ts already loaded the root .env into process.env; here we only validate the API's subset.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const header = req.headers['x-correlation-id'];
          const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
          res.setHeader('x-correlation-id', id);
          return id;
        },
      },
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: seconds(60), limit: 100 }] }),
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    HealthModule,
    // Verification stub only outside production (fail-closed: an unset NODE_ENV excludes it).
    ...(process.env.NODE_ENV === 'development' ? [DevModule] : []),
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
