import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service';

/**
 * PasswordService is a dependency-free leaf (it only wraps @node-rs/argon2). Hosting it in its own
 * @Global module lets both AuthModule and UsersModule inject it without AuthModule and UsersModule
 * importing each other — which would be a circular dependency.
 */
@Global()
@Module({
  providers: [PasswordService],
  exports: [PasswordService],
})
export class CryptoModule {}
