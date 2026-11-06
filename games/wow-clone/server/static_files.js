// Serves the game's files (index.html, client/, shared/, vendor/...) to
// browsers, with no dependencies.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Folders under [root] that are never served. */
const PRIVATE = ['server', 'tests', 'tools', 'logs', 'node_modules', '.git', '.github'];

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
