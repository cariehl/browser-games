import { defineConfig } from 'vite';

// `--mode pages` is the serverless build for GitHub Pages: relative asset paths so it works from a
// project subpath, and client/.env.pages switches the game to in-browser AI (see client/src/net.ts).
export default defineConfig(({ mode }) => ({
  root: 'client',
  base: mode === 'pages' ? './' : '/',
  publicDir: false,
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, host: true },
}));
