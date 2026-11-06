// The raid game server: Colyseus rooms plus the game's files, on one port.
//
//   npm start                  port 2567
//   npm start -- --port 8080
//   npm run dev                the same, restarting when server code changes
//
// Players open http://<host>:<port>/.

import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEFAULT_PORT, ROOM_LOBBY, ROOM_RAID } from '../shared/constants.js';
import { LobbyRoom } from './rooms/lobby_room.js';
import { RaidRoom } from './rooms/raid_room.js';
import { staticFiles } from './static_files.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Starts a server. Resolves to { port, close() }. */
export async function startServer({ port = DEFAULT_PORT } = {}) {
  const httpServer = http.createServer();
  const server = new Server({ transport: new WebSocketTransport({ server: httpServer }), gracefullyShutdown: false, greet: false });
  server.define(ROOM_LOBBY, LobbyRoom);
  server.define(ROOM_RAID, RaidRoom);
  await server.listen(port);

  // Colyseus answers its matchmaking requests; everything else is a file.
  const colyseus = httpServer.listeners('request');
  httpServer.removeAllListeners('request');
  const files = staticFiles(ROOT);
  httpServer.on('request', async (req, res) => {
    if (req.url.startsWith('/matchmake') || req.url.startsWith('/__')) {
      for (const listener of colyseus) listener.call(httpServer, req, res);
    } else if (req.url === '/server-info') {
      // What the join screen shows: how many raids are running.
      const raids = await matchMaker.query({ name: ROOM_RAID });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ raids: raids.length }));
    } else {
      files(req, res);
    }
  });

  const actualPort = httpServer.address().port;
  return { port: actualPort, close: () => server.gracefullyShutdown(false) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { port: { type: 'string' } } });
  const port = Number(values.port || process.env.PORT || DEFAULT_PORT);
  const { close } = await startServer({ port });
  console.log(`Raid server: http://localhost:${port}/`);
  const stop = async () => {
    console.log('Shutting down…');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
