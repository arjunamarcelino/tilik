import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// The single repo-root .env is loaded by ./load-env.mjs (NODE_OPTIONS preload in the package scripts),
// so process.env is populated for the CLI, this config, AND the render workers. Only NEXT_PUBLIC_*
// reaches the browser; web code must never read a non-public key.

const nextConfig: NextConfig = {
  // @tilik/shared is a workspace package — let Next compile/bundle it consistently.
  transpilePackages: ['@tilik/shared'],

  // Prod container (Prompt 14): emit a self-contained server (`.next/standalone/apps/web/server.js` +
  // hoisted node_modules + traced packages/*) so the runtime image ships no pnpm/workspace graph.
  output: 'standalone',
  // Trace from the MONOREPO ROOT, not apps/web — a top-level key in Next 16 (no longer under
  // `experimental`). Without it, file tracing roots at apps/web and omits the transpiled @tilik/shared
  // workspace dep → "module not found" at runtime. __dirname = apps/web for the compiled config.
  outputFileTracingRoot: resolve(__dirname, '..', '..'),
  experimental: {
    // Raise the Server Action body cap (default 1 MB) so the /import multipart upload (manifest + evidence
    // files) fits — the synthetic bundle is well under this. NOTE: this is a GLOBAL Next setting (there is
    // no per-action limit), so it applies to EVERY Server Action (login, decide, logout…), and Next buffers
    // the full body BEFORE the action runs its auth gate. Kept as small as the upload allows to bound that
    // pre-auth buffering; request bodies are also capped at the edge (infra/Caddyfile `request_body`). The
    // API enforces its own 5 MiB/part + 600-part limits downstream.
    serverActions: { bodySizeLimit: '6mb' },
  },
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
