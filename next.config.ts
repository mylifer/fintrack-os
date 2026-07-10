import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers for a finance app. Deliberately NO Content-Security
  // -Policy here: the app ships an inline theme script (layout.tsx) and loads
  // Supabase / the price API / Vercel speed-insights, so a CSP needs a proper
  // nonce-based pass to avoid breaking those — tracked as a dedicated follow-up.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },                       // clickjacking
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
