import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg ships native-optional code paths; keep it out of the server bundle
  serverExternalPackages: ['pg'],
  // phones on the same wifi / a tunnel hit the dev server from another origin
  allowedDevOrigins: ['*.local', '*.trycloudflare.com', '*.ngrok-free.app', '192.168.*.*', '10.*.*.*'],
};

export default nextConfig;
