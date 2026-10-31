import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  development = 'development',
  test = 'test',
  production = 'production',
}

/**
 * The API's environment contract. Only the vars the API actually consumes are validated — the single
 * repo-root .env also carries the owner DATABASE_URL (which the API must NOT use), so unknown vars are
 * ignored (never rejected). NODE_ENV has no default: an unset value fails the boot closed, so production
 * hardening (seed-password requirement, no dev stub) can never silently fall into dev mode.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT!: number;

  // Runtime CRUD connection — the NON-OWNER tilik_app role. Never DATABASE_URL (owner): the append-only
  // grant only binds a non-owner. PrismaService also asserts current_user = 'tilik_app' at boot.
  @IsString()
  APP_DATABASE_URL!: string;

  // ≥ 44 chars ≈ 32 random bytes of base64 (openssl rand -base64 32). MinLength counts characters.
  @IsString()
  @MinLength(44)
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRES_IN = '60m';

  // The single web origin allowed by CORS (e.g. http://localhost:3000).
  @IsString()
  CORS_ORIGIN!: string;

  // Keyed HMAC secret for patient-id pseudonymization (Prompt 06). Consumed as the literal env-string's
  // UTF-8 bytes (never base64-decoded) so the Python detector reproduces identical tokens. ≥ 44 chars
  // ≈ 32 random bytes of base64 (openssl rand -base64 32). Rotating it re-pseudonymizes everyone.
  @IsString()
  @MinLength(44)
  PATIENT_TOKEN_HMAC_KEY!: string;

  // MinIO / S3 object store for file evidence (Prompt 06). MINIO_ENDPOINT is a URL (http://host:port)
  // parsed into endPoint/port/useSSL by MinioService.
  @IsString()
  MINIO_ENDPOINT!: string;

  @IsString()
  MINIO_ACCESS_KEY!: string;

  @IsString()
  MINIO_SECRET_KEY!: string;

  @IsString()
  MINIO_BUCKET!: string;

  // Claude API key for the evidence-summary endpoint (Prompt 13). Server-side only — never exposed to the
  // web tier (apps/web/load-env.mjs prunes it out of the browser/render workers) and never logged. Required
  // + non-empty so a blank key fails the boot closed rather than 401-ing mid-stream on the first request.
  @IsString()
  @IsNotEmpty()
  ANTHROPIC_API_KEY!: string;

  @IsOptional()
  @IsEmail()
  SEED_ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  SEED_ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsEmail()
  SEED_REVIEWER_EMAIL?: string;

  @IsOptional()
  @IsString()
  SEED_REVIEWER_PASSWORD?: string;
}

export function validate(raw: Record<string, unknown>): EnvironmentVariables {
  // enableImplicitConversion coerces the string env values (e.g. API_PORT) to their declared types.
  const config = plainToInstance(EnvironmentVariables, raw, { enableImplicitConversion: true });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return config;
}
