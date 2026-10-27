// The raid game server: Colyseus rooms plus the built client, on one port.
//
//   npm start                  builds the client, then serves it and the game on 2567
//   npm run serve              the same without building
//   npm run serve -- --port 8080
//   npm run dev                server with --dev (no files; Vite serves the client on 5173)
//
// Players open http://<host>:<port>/.

import http from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEFAULT_PORT, ROOM_LOBBY, ROOM_RAID } from '../shared/constants';
import { LobbyRoom } from './rooms/LobbyRoom';
import { RaidRoom } from './rooms/RaidRoom';
import { staticFiles } from './static_files';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIST = join(ROOT, 'client', 'dist');

export interface ServerOptions {
  port?: number;
  /** Serve the built client too (off in dev, where Vite serves it). */
  serveClient?: boolean;
  quiet?: boolean;
}

/** Starts a server. Resolves to { port, close() }. */
export async function startServer({ port = DEFAULT_PORT, serveClient = true, quiet = false }: ServerOptions = {}) {
  const httpServer = http.createServer();
  const server = new Server({ transport: new WebSocketTransport({ server: httpServer }), gracefullyShutdown: false, greet: false });
  server.define(ROOM_LOBBY, LobbyRoom);
  server.define(ROOM_RAID, RaidRoom);
  await server.listen(port);

  // Colyseus answers its matchmaking requests; everything else is a file.
  const colyseus = httpServer.listeners('request') as http.RequestListener[];
  httpServer.removeAllListeners('request');
  const files = serveClient ? staticFiles(CLIENT_DIST) : null;
  httpServer.on('request', async (req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/matchmake') || url.startsWith('/__')) {
      for (const listener of colyseus) listener.call(httpServer, req, res);
    } else if (url === '/server-info') {
      // What the join screen shows: how many raids are running.
      const raids = await matchMaker.query({ name: ROOM_RAID });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ raids: raids.length }));
    } else if (files) {
      files(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('The client is served by Vite in dev mode: http://localhost:5173/');
    }
  });

  if (serveClient && !existsSync(join(CLIENT_DIST, 'index.html')) && !quiet) {
    console.warn('client/dist is missing: run `npm run build` (or `npm start`, which builds first).');
  }
  const actualPort = (httpServer.address() as { port: number }).port;
  return { port: actualPort, close: () => server.gracefullyShutdown(false) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, dev: { type: 'boolean' } } });
  const port = Number(values.port || process.env.PORT || DEFAULT_PORT);
  const { close } = await startServer({ port, serveClient: !values.dev });
  console.log(values.dev
    ? `Raid server on port ${port} (dev: open the client at http://localhost:5173/)`
    : `Raid server: http://localhost:${port}/`);
  const stop = async () => {
    console.log('Shutting down…');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
