import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers for a finance app. The Content-Security-Policy is
  // NOT set here: it is per-request and nonce-based, generated in src/proxy.ts
  // (currently shipped as Content-Security-Policy-Report-Only). COOP is static,
  // so it lives here alongside the other baseline headers.
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
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },      // cross-origin tab isolation
        ],
      },
      {
        // Service worker asla önbelleklenmemeli: yeni deploy'da tarayıcı her
        // zaman güncel sw.js'i görmeli, yoksa eski kabuk günlerce takılı kalır.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
};

export default nextConfig;
