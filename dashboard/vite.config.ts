import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Mamdani Command: the city staff dashboard. Shares the web app's types, service targets and the
// 3D Mamdani (../lib, ../components/mayor). In dev, /api goes to the Next app — run `npm run dev`
// at the repo root, or point API_PROXY at a deployment.
const API = process.env.API_PROXY || 'http://localhost:3000';
const up = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Dev only: icon.html renders Mamdani's face from the 3D model and posts the PNGs here, which
// writes them into public/ (dashboard icons) and ../mobile/assets (the phone app's icons).
const iconStudio = (): Plugin => ({
  name: 'icon-studio',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__icon', (req, res) => {
      const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
      if (!/^(public|mobile)\/[\w-]+\.png$/.test(name)) return void res.writeHead(400).end();
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const file = name.startsWith('mobile/') ? up(`../mobile/assets/${name.slice(7)}`) : up(`./${name}`);
        writeFileSync(file, Buffer.concat(chunks));
        res.writeHead(200).end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), iconStudio()],
  resolve: {
    alias: { '@/': up('../'), '@shared': up('../lib'), '@mayor': up('../components/mayor'), '@models': up('../mobile/assets/models') },
    // the shared mayor code imports three from the repo root; use one copy
    dedupe: ['three'],
  },
  assetsInclude: ['**/*.mrig'],
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [up('..')] },
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
