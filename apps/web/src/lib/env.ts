import 'server-only';

/**
 * API base URL for the server-side client. Read lazily (not at module load) so a missing var fails a
 * request with a clear error rather than breaking the build. `NEXT_PUBLIC_API_URL` is the bare origin;
 * the `/v1` global prefix is appended here.
 *
 * Why `NEXT_PUBLIC_` though this is read ONLY server-side (review P3-15): the Prompt 10 spec named it, and
 * being build-inlined it is reliably available to the server even without the preload. The API origin is
 * not a secret, so the browser-exposing prefix is harmless here — a server-only `API_URL` would read truer
 * but gains nothing functional. Documented rather than renamed to avoid churn.
 */
export function apiBase(): string {
  const origin = process.env.NEXT_PUBLIC_API_URL;
  if (!origin) {
    throw new Error('NEXT_PUBLIC_API_URL is not set (expected e.g. http://localhost:3001).');
  }
  return `${origin.replace(/\/$/, '')}/v1`;
}
