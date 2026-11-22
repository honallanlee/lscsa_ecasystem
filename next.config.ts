import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        { key: 'X-Robots-Tag', value: 'noindex' }
      ]
    }];
  }
};
export default config;
