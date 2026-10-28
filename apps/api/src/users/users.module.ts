import { Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { UsersService } from './users.service';

// PasswordService lives here (not in a separate module): UsersService needs it, and AuthService reaches it
// transitively through AuthModule's existing UsersModule import — so no circular dependency arises.
@Module({
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
