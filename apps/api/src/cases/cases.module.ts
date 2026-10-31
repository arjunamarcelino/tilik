import { Module } from '@nestjs/common';
import { MinioModule } from '../minio/minio.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { EvidenceController } from './evidence.controller';
import { EvidenceIntegrityService } from './evidence-integrity.service';

// PrismaService (@Global PrismaModule) and AuditService (@Global AuditModule) are ambient. MinioModule is
// NOT global (import it) — the evidence download + integrity verification are its second consumer.
@Module({
  imports: [MinioModule],
  controllers: [CasesController, EvidenceController],
  providers: [CasesService, EvidenceIntegrityService],
})
export class CasesModule {}
