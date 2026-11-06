// Copies the browser libraries from node_modules into vendor/, where the page
// loads them from (the game has no build step). Run after upgrading three or
// @colyseus/sdk:  npm run vendor

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** [files]: paths inside the package, copied to the same paths under vendor/[name], or [from, to] pairs. */
function vendor(pkg, name, files) {
  const from = join(ROOT, 'node_modules', pkg);
  const to = join(ROOT, 'vendor', name);
  rmSync(to, { recursive: true, force: true });
  for (const file of files) {
    const [src, dest] = Array.isArray(file) ? file : [file, file];
    mkdirSync(dirname(join(to, dest)), { recursive: true });
    copyFileSync(join(from, src), join(to, dest));
  }
  const { version } = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
  console.log(`Copied ${pkg} ${version} to vendor/${name}`);
}

vendor('three', 'three', ['LICENSE', 'build/three.module.js', 'build/three.core.js', 'examples/jsm/renderers/CSS2DRenderer.js']);
vendor('@colyseus/sdk', 'colyseus', ['LICENSE', ['dist/colyseus.js', 'colyseus.js']]);
