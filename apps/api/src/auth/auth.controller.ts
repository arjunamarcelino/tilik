import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { AuthService, LoginResult } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';

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
}
