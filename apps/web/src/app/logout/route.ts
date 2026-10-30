import { NextResponse, type NextRequest } from 'next/server';
import { deleteSession } from '@/lib/session';

/**
 * Programmatic logout landing — the render-path 401 in the DAL redirects here (an RSC render can't mutate
 * cookies, a Route Handler can). NOT the user-facing logout (that's the POST Server Action in lib/actions).
 * Guarded against cross-site GETs (logout-CSRF / prefetch): a browser only sends Sec-Fetch-Site:same-origin
 * for in-app navigations; cross-site requests are ignored. Never render /logout as a <Link> (prefetch).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  await deleteSession();
  return NextResponse.redirect(new URL('/login', req.url));
}
