import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** @Global so AuditService is injectable into the global interceptor, guards, and any domain module. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
