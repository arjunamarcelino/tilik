// Next 16 renamed Middleware → Proxy. Runs on the NODE runtime. req.cookies.get() here is SYNCHRONOUS
// (NextRequest API) — distinct from the async cookies() helper used in Server Components/Actions.
// OPTIMISTIC redirect only: the real gate is the API (per-request JWT re-validation) reached via the DAL.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/constants';

export default function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;

  if (pathname === '/login') {
    return token ? NextResponse.redirect(new URL('/dashboard', req.nextUrl)) : NextResponse.next();
  }
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // Exclude static assets and the logout route (it manages the cookie itself). Keeps the proxy off
  // _next internals so it isn't invoked on every asset request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logout|.*\\.(?:svg|png|ico|txt)$).*)'],
};
