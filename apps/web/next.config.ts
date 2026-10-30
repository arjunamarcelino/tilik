import type { NextConfig } from 'next';

// The single repo-root .env is loaded by ./load-env.mjs (NODE_OPTIONS preload in the package scripts),
// so process.env is populated for the CLI, this config, AND the render workers. Only NEXT_PUBLIC_*
// reaches the browser; web code must never read a non-public key.

const nextConfig: NextConfig = {
  // @tilik/shared is a workspace package — let Next compile/bundle it consistently.
  transpilePackages: ['@tilik/shared'],
  async headers() {
    // Defense-in-depth: httpOnly keeps the token out of JS, CSP shrinks the XSS blast radius that could
    // otherwise ride the server-forwarded session. Kept minimal for a prototype.
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "img-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
