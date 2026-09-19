import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const noStoreHeaders = [
  { key: 'Cache-Control', value: 'no-store, private' },
  { key: 'CDN-Cache-Control', value: 'no-store' },
  { key: 'Vary', value: 'Cookie' },
];

const nextConfig: NextConfig = {
  // Keep the Node build separate from the previous Sites/vinext artifacts.
  distDir: '.next-node',
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/login', headers: noStoreHeaders },
      { source: '/management/:path*', headers: noStoreHeaders },
      { source: '/engineering/:path*', headers: noStoreHeaders },
      { source: '/mobile/:path*', headers: noStoreHeaders },
      { source: '/api/auth/:path*', headers: noStoreHeaders },
      { source: '/api/work-items', headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
