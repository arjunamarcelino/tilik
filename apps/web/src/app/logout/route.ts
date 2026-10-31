import { NextResponse, type NextRequest } from 'next/server';
import { deleteSession } from '@/lib/session';

/**
 * Programmatic logout landing — the render-path 401 in the DAL redirects here (an RSC render can't mutate
 * cookies, a Route Handler can). NOT the user-facing logout (that's the POST Server Action in lib/actions).
 * Guarded against cross-site GETs (logout-CSRF / prefetch): a browser sends Sec-Fetch-Site:same-origin for
 * in-app navigations (and :none for an address-bar hit / the DAL's server-side redirect). FAIL CLOSED —
 * proceed only for those two values; a missing header (non-browser client) is treated as untrusted
 * (review P3-6). Never render /logout as a <Link> (prefetch would log the user out).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const site = req.headers.get('sec-fetch-site');
  if (site !== 'same-origin' && site !== 'none') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  await deleteSession();
  return NextResponse.redirect(new URL('/login', req.url));
}
