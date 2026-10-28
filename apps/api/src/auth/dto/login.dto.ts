import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254) // RFC 5321 practical maximum for an email address
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256) // bound the credential before it reaches argon2 (OWASP ASVS V2.1)
  password!: string;
}
