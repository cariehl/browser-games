// Serves the game's files (index.html, src/, data/, vendor/...) to browsers,
// with no dependencies. Used by the game server and by tools/serve.js.

import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.map': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/** Folders under [root] that are never served (server saves, installed packages, git). */
const PRIVATE = ['saves', 'node_modules', '.git', 'server'];

/** A request handler serving files under [root]. */
export function staticFiles(root) {
  return async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(root, path));
      if (file !== root && !file.startsWith(root + sep)) throw Object.assign(new Error('outside root'), { code: 'ENOENT' });
      const top = file.slice(root.length + 1).split(sep)[0];
      if (PRIVATE.includes(top)) throw Object.assign(new Error('private'), { code: 'ENOENT' });
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (error) {
      const missing = error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR';
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(missing ? 'Not found' : 'Server error');
    }
  };
}
