// The content editor: a local web page for editing the game's data files
// (items, NPCs, recipes, quests, dialogue, messages, rules...) and painting
// the maps. It reads and writes data/ directly, so what you save is what the
// game loads next time the server starts; commit the changes with git.
//
//   npm run editor        (then open http://localhost:8090)
//   npm run editor -- --port 9000 --no-open
//
// Only listens on this computer (127.0.0.1): it can write files.

import { createServer } from 'node:http';
import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { ROOT } from '../../src/sim/load_node.js';
import { staticFiles } from '../../server/static_files.js';
import { format } from './format.js';

const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 8090;
const DATA = join(ROOT, 'data');

/** [path] (like "data/items.json") as an absolute path inside data/, or null. */
function dataPath(path) {
  const file = normalize(join(ROOT, path || ''));
  if (!file.startsWith(DATA + sep)) return null;
  if (!file.endsWith('.json') && !file.endsWith('.map')) return null;
  return file;
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(value));
}

/** Every data file's text: { "data/items.json": "...", "data/maps/scrapyard.map": "..." }. */
async function allFiles() {
  const out = {};
  for (const dir of ['data', 'data/maps']) {
    for (const name of await readdir(join(ROOT, dir))) {
      if (name.endsWith('.json') || name.endsWith('.map')) out[`${dir}/${name}`] = await readFile(join(ROOT, dir, name), 'utf8');
    }
  }
  return out;
}

/** Writes through a temp file, so a crash never leaves half a file. */
async function save(file, text) {
  await writeFile(file + '.tmp', text, 'utf8');
  await rename(file + '.tmp', file);
}

function runChecks() {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, 'tools', 'editor', 'check.js')], { cwd: ROOT, maxBuffer: 1 << 24 }, (error, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve([{ check: 'Checks', text: (stderr || (error && error.message) || 'The checks crashed.').trim() }]);
      }
    });
  });
}

const files = staticFiles(ROOT);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/' || url.pathname === '/editor') {
      res.writeHead(302, { Location: '/tools/editor/' });
      return res.end();
    }
    if (url.pathname === '/api/files' && req.method === 'GET') return send(res, 200, await allFiles());
    if (url.pathname === '/api/file' && req.method === 'PUT') {
      const file = dataPath(url.searchParams.get('path'));
      if (!file) return send(res, 400, { error: 'Only files in data/ can be written.' });
      let text = await body(req);
      if (file.endsWith('.json')) {
        let data;
        try {
          data = JSON.parse(text);
        } catch (error) {
          return send(res, 400, { error: `Not valid JSON: ${error.message}` });
        }
        let original = '';
        try {
          original = await readFile(file, 'utf8');
        } catch {
          original = '';
        }
        text = format(data, original);
      }
      await save(file, text);
      return send(res, 200, { ok: true, text });
    }
    if (url.pathname === '/api/check' && req.method === 'POST') return send(res, 200, await runChecks());
    return files(req, res);
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const address = `http://localhost:${PORT}/`;
  console.log(`MechScape content editor: ${address}`);
  console.log('Edits are saved straight into data/. Restart the game server to see them in game. Ctrl+C to stop.');
  if (!args.includes('--no-open')) {
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]]
      : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
    try {
      spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch {
      // No browser to open; the address is printed above.
    }
  }
});
