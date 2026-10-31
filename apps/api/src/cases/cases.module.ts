import { Module } from '@nestjs/common';
import { MinioModule } from '../minio/minio.module';
import { CaseContextService } from './case-context.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { EvidenceController } from './evidence.controller';
import { EvidenceIntegrityService } from './evidence-integrity.service';
import { SummaryService } from './summary.service';

// PrismaService (@Global PrismaModule), AuditService (@Global AuditModule), and ConfigService (@Global
// ConfigModule) are ambient. MinioModule is NOT global (import it) — the evidence download + integrity
// verification are its second consumer. CaseContextService is the shared, side-effect-free case gather
// consumed by both the detail read (CasesService) and the Claude summary (SummaryService, Prompt 13).
@Module({
  imports: [MinioModule],
  controllers: [CasesController, EvidenceController],
  providers: [CaseContextService, CasesService, EvidenceIntegrityService, SummaryService],
})
export class CasesModule {}
