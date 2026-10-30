import type { NextConfig } from 'next';

// The single repo-root .env is loaded by ./load-env.mjs (NODE_OPTIONS preload in the package scripts),
// so process.env is populated for the CLI, this config, AND the render workers. Only NEXT_PUBLIC_*
// reaches the browser; web code must never read a non-public key.

const nextConfig: NextConfig = {
  // @tilik/shared is a workspace package — let Next compile/bundle it consistently.
  transpilePackages: ['@tilik/shared'],
  async headers() {
    // Static security headers only. The Content-Security-Policy is NOT here — it needs a per-request
    // nonce (a static `script-src 'self'` blocks Next's inline scripts and breaks hydration), so it is
    // emitted in proxy.ts where the nonce is generated. See src/proxy.ts (review P1-1).
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
