import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { Me } from '@tilik/shared/contracts';
import { AuthService, LoginResult } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from '../common/types/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Public (no JWT) but rate-limited harder than the global throttle to blunt brute-force on credentials.
  @Public()
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.email, dto.password);
  }

  // Authenticated (global JwtAuthGuard gates it — not @Public, no @Roles): identity + liveness probe for
  // the portal. A deactivated/expired caller gets 401 here, which the web treats as "log out".
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.auth.profile(user.userId);
  }
}
