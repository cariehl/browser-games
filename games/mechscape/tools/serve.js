// A tiny static file server for playing offline (single player, no game
// server), with no dependencies:
//
//   node tools/serve.js [port]      (or npm run offline)
//
// then open http://localhost:8000/?offline. Any static server works the same
// (python -m http.server, for one); browsers just won't load ES modules
// from file:// URLs. For multiplayer, run the game server instead (npm start).

import { createServer } from 'node:http';
import { ROOT } from '../src/sim/load_node.js';
import { staticFiles } from '../server/static_files.js';

const port = Number(process.argv[2] || process.env.PORT || 8000);

createServer(staticFiles(ROOT)).listen(port, () => {
  console.log(`MechScape (offline): http://localhost:${port}/?offline`);
});
