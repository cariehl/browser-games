// Serves the built client (client/dist) to browsers, with no dependencies.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

/** A request handler serving files under [root]. */
export function staticFiles(root: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      let file = normalize(join(root, path));
      if (file !== root && !file.startsWith(root + sep)) throw Object.assign(new Error('outside root'), { code: 'ENOENT' });
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      // Vite fingerprints everything under assets/, so those can be cached for good.
      const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
      res.end(body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const missing = code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR';
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(missing ? 'Not found' : 'Server error');
    }
  };
}
