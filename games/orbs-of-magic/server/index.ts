import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuelRoom } from './DuelRoom';

const PORT = Number(process.env.PORT ?? 2567);
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
