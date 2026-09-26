import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// /api goes to the deployed Next app unless you run it locally (API_PROXY=http://localhost:3000).
const API = process.env.API_PROXY || 'https://mamdani.vercel.app';

export default defineConfig({
  plugins: [react()],
  // Pre-bundle every dependency on the first pass. If Vite discovers one later it re-optimizes
  // and renames its cache folder, which Windows often blocks (EPERM → "504 Outdated Optimize Dep",
  // blank page).
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      '@auth0/auth0-react', 'lucide-react', 'mapbox-gl',
      'three', 'three/examples/jsm/loaders/GLTFLoader.js',
    ],
  },
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  test: {
    environment: 'jsdom',
    setupFiles: './src/testSetup.ts',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: true, secure: true },
    },
  },
});
