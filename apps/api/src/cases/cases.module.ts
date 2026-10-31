import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

// PrismaService (@Global PrismaModule) is ambient; nothing else to import.
@Module({
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
