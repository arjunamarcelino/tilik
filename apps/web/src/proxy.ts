// Next 16 renamed Middleware → Proxy. Runs on the NODE runtime. req.cookies.get() here is SYNCHRONOUS
// (NextRequest API) — distinct from the async cookies() helper used in Server Components/Actions.
// Two jobs: (1) OPTIMISTIC auth redirect (the real gate is the API's per-request JWT re-validation via
// the DAL); (2) emit a per-request nonce CSP so Next's inline bootstrap/RSC-flight scripts can run — a
// static `script-src 'self'` has no nonce and blocks them, which kills hydration (review P1-1).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/constants';

function cspWithNonce(nonce: string): string {
  // 'strict-dynamic' lets the nonce'd Next bootstrap load its own chunk scripts; 'self' is the
  // pre-'strict-dynamic' fallback. No inline script runs without the nonce → XSS blast radius stays small.
  // Dev only: Turbopack HMR uses eval(), so 'unsafe-eval' is added in development and never in production.
  const devEval = process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
    "style-src 'self' 'unsafe-inline'", // Tailwind injects inline styles
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export default function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;

  // Optimistic auth redirects (no body → CSP irrelevant on these).
  if (pathname === '/login') {
    if (token) return NextResponse.redirect(new URL('/dashboard', req.nextUrl));
  } else if (!token) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }

  // Rendered responses: thread a fresh nonce so Next stamps nonce="…" on every inline <script> it emits.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = cspWithNonce(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp); // Next reads the nonce from here to stamp its scripts

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Exclude static assets and the logout route (it manages the cookie itself). Keeps the proxy off
  // _next internals so it isn't invoked on every asset request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logout|.*\\.(?:svg|png|ico|txt)$).*)'],
};
