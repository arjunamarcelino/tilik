// Plain (NOT server-only) so both the server-only session helpers AND proxy.ts can import it.
// The session cookie name lives here once; renaming it must not silently break the proxy's redirect.
export const SESSION_COOKIE = 'session';
