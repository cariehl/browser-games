// A tiny static file server for playing locally, with no dependencies:
//
//   node tools/serve.js [port]      (or npm start)
//
// then open http://localhost:8000. Any static server works the same
// (python -m http.server, for one); browsers just won't load ES modules
// from file:// URLs.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { ROOT } from '../src/sim/load_node.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.map': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const port = Number(process.argv[2] || process.env.PORT || 8000);

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) throw Object.assign(new Error('outside root'), { code: 'ENOENT' });
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(port, () => {
  console.log(`MechScape: http://localhost:${port}`);
});
