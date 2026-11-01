import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/constants';
import { apiBase } from '@/lib/env';

// Node runtime (reads the httpOnly cookie, relays a binary stream); never cached (authed per-user binary).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BFF proxy for evidence file download. Forwards the cookie-derived Bearer to the case-scoped API route and
 * relays the streamed bytes with the download headers + a locked-down resource CSP (the binary must never
 * execute as a document). Excluded from proxy.ts's page CSP so this policy wins. A Route Handler, not a
 * Server Action — only a Response can stream binary and set Content-Disposition.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; evidenceId: string }> },
): Promise<Response> {
  const { id, evidenceId } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiBase()}/cases/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/download`,
      { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
  } catch {
    return new Response('The API is unreachable.', { status: 502 });
  }

  if (upstream.status === 401) redirect('/logout');
  if (upstream.status === 403) return new Response('Forbidden', { status: 403 });
  if (upstream.status === 404) notFound();
  if (upstream.status === 409) {
    return new Response(
      'Evidence failed its integrity check. The file may have been tampered with.',
      {
        status: 409,
      },
    );
  }
  if (!upstream.ok || !upstream.body) return new Response('Download failed.', { status: 502 });

  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'content-length']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store, private');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  return new Response(upstream.body, { status: 200, headers });
}
