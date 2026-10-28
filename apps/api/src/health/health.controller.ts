import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Public and excluded from the /v1 prefix (see app.setup.ts) → stable /health for infra probes.
  @Public()
  @Get()
  async health(): Promise<{ status: string; db: string }> {
    if (!(await this.prisma.ping())) {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up' };
  }
}
