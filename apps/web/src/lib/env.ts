import 'server-only';

/**
 * API base URL for the server-side client. Read lazily (not at module load) so a missing var fails a
 * request with a clear error rather than breaking the build. `NEXT_PUBLIC_API_URL` is the bare origin;
 * the `/v1` global prefix is appended here.
 */
export function apiBase(): string {
  const origin = process.env.NEXT_PUBLIC_API_URL;
  if (!origin) {
    throw new Error('NEXT_PUBLIC_API_URL is not set (expected e.g. http://localhost:3001).');
  }
  return `${origin.replace(/\/$/, '')}/v1`;
}
