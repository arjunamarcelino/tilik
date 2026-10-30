import 'server-only';
import { cookies } from 'next/headers';

const COOKIE = 'session';
// Scoped to the API's 60-min JWT as a best-effort UX bound; the API's per-request re-validation (and
// the DAL's 401→logout) is the real authority, so this is a hint, not a security boundary.
const MAX_AGE_SECONDS = 60 * 60;

export async function createSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(COOKIE); // path must match the one used in set() ('/')
}
