import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@tilik/db';
import { PasswordService } from '../crypto/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { EnvironmentVariables, NodeEnv } from '../config/env.validation';

interface SeedSpec {
  email: string;
  password: string | undefined;
  role: 'ADMIN' | 'REVIEWER';
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Emails are stored lowercased to match the DB's UNIQUE (lower(email)) index. */
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findActiveById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  private async seed(): Promise<void> {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === NodeEnv.production;
    const specs: SeedSpec[] = [
      {
        email: this.config.get('SEED_ADMIN_EMAIL', { infer: true }) ?? 'admin@tilik.local',
        password: this.config.get('SEED_ADMIN_PASSWORD', { infer: true }),
        role: 'ADMIN',
      },
      {
        email: this.config.get('SEED_REVIEWER_EMAIL', { infer: true }) ?? 'reviewer@tilik.local',
        password: this.config.get('SEED_REVIEWER_PASSWORD', { infer: true }),
        role: 'REVIEWER',
      },
    ];

    for (const spec of specs) {
      const email = spec.email.toLowerCase();
      // find-then-skip (never upsert): upsert's update branch would clobber passwordHash/role on every boot.
      if (await this.findByEmail(email)) continue;

      let password = spec.password;
      if (!password) {
        if (isProd) {
          throw new Error(`Refusing to seed ${spec.role}: set its SEED_*_PASSWORD in production.`);
        }
        password = randomBytes(12).toString('base64url');
        this.logger.warn(
          `⚠️  SEEDED ${spec.role} ${email} WITH A GENERATED DEV PASSWORD: ${password} — DEV ONLY. ` +
            'Set the matching SEED_*_PASSWORD to override.',
        );
      }

      try {
        await this.prisma.user.create({
          data: {
            email,
            role: spec.role,
            passwordHash: await this.password.hash(password),
            isActive: true,
          },
        });
        this.logger.log(`Seeded ${spec.role} user ${email}`);
      } catch (err) {
        // Concurrent boots race on the unique index; P2002 means another instance already seeded it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }
}
