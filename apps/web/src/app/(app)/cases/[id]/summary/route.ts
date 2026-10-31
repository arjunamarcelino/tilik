import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/constants';
import { apiBase } from '@/lib/env';

// Node runtime (reads the httpOnly cookie, relays a text stream); never cached (authed, per-user).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BFF proxy for the evidence-summary token stream (Prompt 13). Forwards the cookie-derived Bearer to the
 * API's streaming POST and pipes the upstream body straight through, so the browser renders tokens as they
 * arrive. A Route Handler, not a Server Action — only a Response can stream incrementally.
 *
 * Unlike the Prompt 12 decision Server Action (which carries Next's action-origin protection), a plain
 * cookie-authenticated POST Route Handler has none — so this adds a Sec-Fetch-Site same-origin check as
 * defence-in-depth over the session cookie's SameSite=lax. Excluded from proxy.ts's matcher (no HTML CSP /
 * buffering on a streamed text body).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // Same-origin only. Browsers send Sec-Fetch-Site on fetch/navigation; absent (older client) → allow.
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return new Response('Forbidden', { status: 403 });

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');

  const body = await req.text(); // { regenerate?: boolean }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/cases/${encodeURIComponent(id)}/summary`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
      cache: 'no-store',
    });
  } catch {
    return new Response('The API is unreachable.', { status: 502 });
  }

  if (upstream.status === 401) redirect('/logout');
  if (upstream.status === 403) return new Response('Forbidden', { status: 403 });
  if (upstream.status === 404) notFound();
  if (upstream.status === 429) return new Response('Too many requests', { status: 429 });
  // Pre-stream failures (refusal/empty → 422, unreachable model → 503) arrive as a real status here because
  // the API defers its header flush to the first token.
  if (!upstream.ok || !upstream.body) return new Response('Summary unavailable.', { status: 502 });

  const headers = new Headers();
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('X-Accel-Buffering', 'no'); // nginx; Caddy uses flush_interval -1 (infra/Caddyfile)
  return new Response(upstream.body, { status: 200, headers });
}
