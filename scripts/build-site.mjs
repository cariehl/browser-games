// Builds the whole games site into dist/, laid out the way cariehl.github.io serves it:
//
//   node scripts/build-site.mjs            build every game, then assemble dist/
//   node scripts/build-site.mjs --no-build assemble from builds already on disk
//
// dist/ is a static site: index.html, img/ and commentary/ from site/, and one
// folder per game at the same URL path as today (orbs/, guidle/, ...). Copy it
// over cariehl.github.io, or point a Pages workflow at it.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const build = !process.argv.includes('--no-build');

// slug: the folder under dist/ (the game's URL path). dir: its source folder.
// steps: commands run in dir to build it. files: what to copy from dir into dist/<slug>.
const GAMES = [
  { slug: 'orbs', dir: 'games/orbs-of-magic', steps: ['npm ci', 'npm run build:pages'], files: ['dist/.'] },
  { slug: 'guidle', dir: 'games/guidle', steps: ['node scripts/build.js'], files: ['index.html'] },
  { slug: 'hexbound', dir: 'games/hexbound', files: ['index.html', 'css', 'js', 'vendor'] },
  { slug: 'hexmancer', dir: 'games/hexmancer', files: ['index.html'] },
  { slug: 'overcharge', dir: 'games/overcharge', files: ['index.html', 'vendor'] },
  { slug: 'mechscape', dir: 'games/mechscape', steps: ['npm run build:pages'], files: ['dist/.'] },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of ['index.html', 'img', 'commentary']) cpSync(join(ROOT, 'site', f), join(OUT, f), { recursive: true });

for (const game of GAMES) {
  const dir = join(ROOT, game.dir);
  if (build) {
    for (const step of game.steps ?? []) {
      console.log(`\n[${game.slug}] ${step}`);
      execSync(step, { cwd: dir, stdio: 'inherit' });
    }
  }
  const dest = join(OUT, game.slug);
  mkdirSync(dest);
  for (const f of game.files) {
    const src = join(dir, f);
    if (!existsSync(src)) throw new Error(`${game.dir}/${f} is missing; build ${game.slug} first`);
    cpSync(src, f.endsWith('/.') ? dest : join(dest, f), { recursive: true });
  }
}

// Served as-is: GitHub Pages would otherwise run Jekyll over it.
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`\nBuilt dist/ with ${GAMES.length} games.`);
