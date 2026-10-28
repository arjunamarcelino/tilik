import { Module } from '@nestjs/common';
import { MinioModule } from '../minio/minio.module';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';

// PrismaService (@Global PrismaModule) and AuditService (@Global AuditModule) are ambient; MinioModule is
// imported explicitly (it's a plain module, this is its only consumer).
@Module({
  imports: [MinioModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
