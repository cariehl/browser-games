import { defineConfig } from 'vite';

// The client lives in client/; it imports ../shared like the server does.
// `npm run build` writes client/dist, which the game server serves.
export default defineConfig({
  root: 'client',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: { port: 5173, host: true },
});
