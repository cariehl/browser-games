// Builds the static copy of the game for GitHub Pages (cariehl.github.io/mechscape/):
//
//   npm run build:pages             writes dist/
//
// The game has no bundling step, so this only copies the files a browser
// needs (no server, tools or tests) and writes build.json with a
// fingerprint of the game's files (server/game_version.js), which the connect
// screen compares with the server's to warn when the two are different
// versions. Replace mechscape/ in cariehl.github.io with dist/.

import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/sim/load_node.js';
import { gameVersion } from '../server/game_version.js';

const OUT = join(ROOT, 'dist');
const FILES = ['index.html', 'style.css', 'favicon.svg', 'favicon.ico', 'src', 'data', 'assets', 'vendor'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const file of FILES) cpSync(join(ROOT, file), join(OUT, file), { recursive: true });
const version = gameVersion();
writeFileSync(join(OUT, 'build.json'), `${JSON.stringify({ version }, null, 2)}\n`);
// Served as-is: GitHub Pages would otherwise run Jekyll over it.
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`Built dist/ (version ${version}). Copy it to mechscape/ in cariehl.github.io.`);
