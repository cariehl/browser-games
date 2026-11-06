import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuelRoom } from './DuelRoom';

// --port 8080 (or --port=8080) beats $PORT, which beats the default.
function portArg(): string | undefined {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--port') return a[i + 1];
    if (a[i].startsWith('--port=')) return a[i].slice(7);
  }
}
const PORT = Number(portArg() ?? process.env.PORT ?? 2567);
const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

// In production the server also hosts the built client.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define('duel', DuelRoom);

gameServer.listen(PORT).then(() => {
  console.log(`✨ Orbs of Magic server listening on http://localhost:${PORT}`);
});
