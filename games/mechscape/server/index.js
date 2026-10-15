// The MechScape game server: one authoritative world that everyone plays in,
// over Colyseus, plus the game's files for browsers, all on one port.
//
//   npm start                       port 2567, carries on from saves/world.json
//   npm start -- --new              a fresh world (the old save becomes the .bak)
//   npm start -- --port 8080
//   npm run dev                     allow debug actions (or --debug, or MECHSCAPE_DEBUG=1)
//   npm start -- --xp-rate 1.5      every XP gain x1.5: the session's tuning knob
//
// Players open http://<host>:<port>/ and pick a name.

import http from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOT, loadContentFromDisk } from '../src/sim/load_node.js';
import { Game } from './game.js';
import { WorldStore } from './world_store.js';
import { ScrapyardRoom } from './scrapyard_room.js';
import { staticFiles } from './static_files.js';

export const ROOM_NAME = 'scrapyard';

/** Starts a server. Returns { game, server, port, close() }. */
export async function startServer({ port = 2567, savePath = join(ROOT, 'saves', 'world.json'), fresh = false, debug = false, quiet = false, xpRate = 1 } = {}) {
  loadContentFromDisk();
  const store = savePath ? new WorldStore(savePath) : null;
  const game = new Game({ store, debug, fresh, xpRate });
  if (!quiet) console.log(game.notice);

  const httpServer = http.createServer();
  const server = new Server({ transport: new WebSocketTransport({ server: httpServer }), gracefullyShutdown: false, greet: !quiet });
  server.define(ROOM_NAME, ScrapyardRoom, { game });
  await server.listen(port);

  // Colyseus answers its matchmaking requests; everything else is a file.
  const colyseus = httpServer.listeners('request');
  httpServer.removeAllListeners('request');
  const files = staticFiles(ROOT);
  httpServer.on('request', (req, res) => {
    if (req.url.startsWith('/matchmake') || req.url.startsWith('/__')) {
      for (const listener of colyseus) listener.call(httpServer, req, res);
    } else if (req.url === '/server-info') {
      // What the connect screen shows before you join.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ xp_rate: game.xpRate, online: game.online.size, debug: game.debug }));
    } else {
      files(req, res);
    }
  });

  const { matchMaker } = await import('@colyseus/core');
  await matchMaker.createRoom(ROOM_NAME, {});
  const actualPort = httpServer.address().port;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    game.save();
    await server.gracefullyShutdown(false);
  };
  return { game, server, port: actualPort, close };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { port: { type: 'string' }, new: { type: 'boolean' }, debug: { type: 'boolean' }, 'xp-rate': { type: 'string' } },
  });
  const port = Number(values.port || process.env.PORT || 2567);
  const debug = !!values.debug || process.env.MECHSCAPE_DEBUG === '1';
  const xpRate = Number(values['xp-rate'] || process.env.MECHSCAPE_XP_RATE || 1);
  if (!(xpRate > 0 && xpRate <= 100)) throw new Error('--xp-rate must be a number above 0 (1 is normal).');
  const { close } = await startServer({ port, fresh: !!values.new, debug, xpRate });
  console.log(`MechScape server: http://localhost:${port}/${debug ? '  (debug actions on)' : ''}${xpRate !== 1 ? `  (XP x${xpRate})` : ''}`);
  const stop = async () => {
    console.log('Saving and shutting down…');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
