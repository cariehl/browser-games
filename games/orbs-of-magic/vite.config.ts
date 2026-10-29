import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: false,
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, host: true },
});
