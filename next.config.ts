import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep the Node build separate from the previous Sites/vinext artifacts.
  distDir: '.next-node',
};

export default nextConfig;
