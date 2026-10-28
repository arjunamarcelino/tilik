import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

// OWASP Password Storage minimum for argon2id (m=19 MiB, t=2, p=1). Raise after benchmarking in-container.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  // A one-time random decoy hash, built lazily. Verifying against it when a user is missing/inactive
  // equalizes login response time so an attacker can't distinguish "no such user" from "wrong password"
  // by timing (the generic error message alone doesn't close that side-channel).
  private decoy?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  verify(hashString: string, password: string): Promise<boolean> {
    return verify(hashString, password);
  }

  /** Spend a comparable amount of time as a real verify, then discard the result. */
  async verifyDecoy(password: string): Promise<void> {
    this.decoy ??= hash(randomBytes(32).toString('base64'), ARGON2_OPTIONS);
    await verify(await this.decoy, password);
  }
}
