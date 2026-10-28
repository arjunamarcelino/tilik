import type { Request } from 'express';
import type { Role } from '@tilik/shared';

/** Decoded JWT body. `sub` is the user id (a cuid), `role` the domain role — no PII ever. */
export interface JwtPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

/** What the JWT strategy's validate() returns — attached to req.user by passport. */
export interface AuthenticatedUser {
  userId: string;
  role: Role;
}

/**
 * A request whose user is guaranteed present. Deny-by-default guards run first, so any handler/guard/
 * interceptor that reads the user can narrow via `getRequest<AuthenticatedRequest>()` instead of `any`.
 */
export type AuthenticatedRequest = Request & { user: AuthenticatedUser };
