import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg ships native-optional code paths; keep it out of the server bundle
  serverExternalPackages: ['pg'],
  // phones on the same wifi / a tunnel hit the dev server from another origin
  allowedDevOrigins: ['*.local', '*.trycloudflare.com', '*.ngrok-free.app', '192.168.*.*', '10.*.*.*'],
  // the Command dashboard (dashboard/, a separate Vite app) calls this API from its own origin
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

export default nextConfig;
