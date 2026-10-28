import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { toDomainRole } from '../../common/roles/role.util';
import type { AuthenticatedUser, JwtPayload } from '../../common/types/auth';
import { EnvironmentVariables } from '../../config/env.validation';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'], // pin the algorithm — defends against alg:none / algorithm-confusion
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  /**
   * Re-check the user on every request (no refresh token exists, so the token is the only revocation
   * boundary). A deactivated user is rejected immediately, and the role is read live — closing both the
   * deactivation and the mid-session demotion windows. Cheap at this scale (indexed PK lookup).
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findActiveById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    return { userId: user.id, role: toDomainRole(user.role) };
  }
}
