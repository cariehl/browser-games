// Copies the Colyseus browser client from node_modules into vendor/, where
// the page loads it from (the game has no build step). Run after upgrading
// @colyseus/sdk:  npm run vendor-sdk

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../src/sim/load_node.js';

const require = createRequire(import.meta.url);
const { version } = require('@colyseus/sdk/package.json');
const out = join(ROOT, 'vendor', 'colyseus');
mkdirSync(out, { recursive: true });
copyFileSync(join(ROOT, 'node_modules', '@colyseus', 'sdk', 'dist', 'colyseus.js'), join(out, 'colyseus.js'));
console.log(`Copied @colyseus/sdk ${version} to vendor/colyseus/colyseus.js`);
