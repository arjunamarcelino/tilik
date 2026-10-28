import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { toDomainRole } from '../common/roles/role.util';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';

export interface LoginResult {
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      await this.password.verifyDecoy(password); // equalize timing — no user-enumeration side-channel
      await this.audit.record({
        actor: 'anonymous',
        action: 'AUTH_LOGIN_FAILED',
        targetType: 'Auth',
        targetId: 'login',
        metadata: { outcome: 'FAILURE' }, // never the attempted email/password
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await this.password.verify(user.passwordHash, password))) {
      await this.audit.record({
        actor: user.id,
        action: 'AUTH_LOGIN_FAILED',
        targetType: 'Auth',
        targetId: 'login',
        metadata: { outcome: 'FAILURE' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Record the audit row BEFORE minting the token: this path fails closed (the write is awaited and
    // not swallowed), so a failed audit must not leave a signed token issued without a trace.
    await this.audit.record({
      actor: user.id,
      action: 'USER_LOGIN',
      targetType: 'User',
      targetId: user.id,
      metadata: { outcome: 'SUCCESS' },
    });
    const accessToken = this.jwt.sign({ sub: user.id, role: toDomainRole(user.role) });
    return { accessToken };
  }
}
