import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const engine = process.env.EYRIE_ENGINE ?? 'http://127.0.0.1:4319';

// The bundle ships third-party code and fonts whose licences require their notices to travel with it.
const licenceFiles = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];
const licences = (): Plugin => ({
  name: 'eyrie-licences',
  apply: 'build',
  generateBundle() {
    for (const fileName of licenceFiles) {
      this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(`../../${fileName}`, import.meta.url)) });
    }
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), licences()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: engine, changeOrigin: true },
      '/ws': { target: engine.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        // The desktop app's Projects page (apps/desktop serves it as eyrie://app/projects.html).
        projects: fileURLToPath(new URL('projects.html', import.meta.url)),
      },
    },
  },
});
