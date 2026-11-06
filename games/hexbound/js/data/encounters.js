// Generated fights for campaign runs: a seeded battlefield for a biome, filled with a faction's monsters to a
// budget and scaled to the party's level. The same (faction, kind, level, heroes, seed) always gives the same
// fight, so a saved run regenerates it exactly. Output is an ordinary scenario object.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const W = 17, H = 12;
  const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const L = (terrain, extra) => Object.assign({ terrain }, extra || {});

  // ---------- biomes: legend, palette and a painter that fills a W×H grid of legend chars ----------
  const BIOMES = {
    forest: {
      palette: { ground: 0x5a8a3c, sky: 0x9fc6e8, fog: 0xb8d4b8, light: 0xfff2d6 },
      legend: { '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), '~': L('water'), '=': L('bridge') },
      paint(g, r) {
        scatter(g, r, 'T', 0.07, 0, 8); scatter(g, r, ',', 0.08, 0, 9); scatter(g, r, 'R', 0.03, 1, 8);
        edges(g, r, 'T', 0.5);
        if (r() < 0.45) { // a creek with a bridge and a ford
          const row = 5 + Math.floor(r() * 2);
          for (let c = 0; c < W; c++) g[row][c] = '~';
          const b = 2 + Math.floor(r() * 5), f = 9 + Math.floor(r() * 5);
          g[row][b] = '='; g[row][f] = ','; g[row][f + 1] = ',';
          if (r() < 0.5) g[row][Math.floor((b + f) / 2)] = '=';
        }
      },
    },
    barrow: {
      palette: { ground: 0x4a5a44, sky: 0x5a6a8a, fog: 0x6a7a7f, light: 0xc8d8ff },
      legend: { '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), '+': L('grave'), '#': L('wall') },
      paint(g, r) {
        for (let row = 1; row <= 7; row += 2) for (let c = 1; c < W - 1; c++) if (r() < 0.22) g[row][c] = '+';
        scatter(g, r, ',', 0.07, 0, 9); edges(g, r, 'T', 0.4);
        const wc = 3 + Math.floor(r() * 10); for (let c = wc; c < Math.min(W - 1, wc + 3); c++) if (r() < 0.8) g[0][c] = '#';
      },
    },
    road: {
      palette: { ground: 0x8a7a55, sky: 0xe39b6b, fog: 0xd9a88a, light: 0xffc48a },
      legend: { '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), 'r': L('road'), 'W': L('wagon'), 't': L('tent'), 'F': L('fire') },
      paint(g, r) {
        let c = 6 + Math.floor(r() * 5);
        for (let row = 0; row < H; row++) { g[row][c] = 'r'; if (c + 1 < W) g[row][c + 1] = 'r'; if (r() < 0.4) c = Math.max(2, Math.min(W - 4, c + (r() < 0.5 ? -1 : 1))); }
        for (let k = 0; k < 3; k++) { const row = 1 + Math.floor(r() * 5), cc = 1 + Math.floor(r() * (W - 3)); if (g[row][cc] === '.' && g[row][cc + 1] === '.') { g[row][cc] = 'W'; g[row][cc + 1] = 'W'; } }
        scatter(g, r, 't', 0.04, 0, 3); scatter(g, r, 'T', 0.04, 0, 9); scatter(g, r, ',', 0.05, 0, 9); edges(g, r, 'T', 0.35);
        const fr = 1 + Math.floor(r() * 3), fc = 2 + Math.floor(r() * (W - 4)); if (g[fr][fc] === '.') g[fr][fc] = 'F';
      },
    },
    bakery: {
      palette: { ground: 0xead2dc, sky: 0xffe9f2, fog: 0xf6dce6, light: 0xfff6e8 },
      legend: { '.': L('tile'), '#': L('wall'), 'P': L('pillar'), 'C': L('counter'), 'f': L('frosting'), 'O': L('oven') },
      paint(g, r) {
        for (let c = 0; c < W; c++) g[0][c] = r() < 0.75 ? '#' : (r() < 0.5 ? 'O' : '.');
        for (let k = 0; k < 4; k++) { const row = 2 + Math.floor(r() * 6), cc = 1 + Math.floor(r() * (W - 3)); g[row][cc] = 'C'; if (r() < 0.5 && cc + 1 < W) g[row][cc + 1] = 'C'; }
        scatter(g, r, 'P', 0.03, 1, 8); scatter(g, r, 'f', 0.06, 1, 9);
      },
    },
  };
  function scatter(g, r, ch, p, r0, r1) { for (let row = r0; row <= r1; row++) for (let c = 0; c < W; c++) if (g[row][c] === '.' && r() < p) g[row][c] = ch; }
  function edges(g, r, ch, p) { for (let row = 0; row < H; row++) for (const c of [0, W - 1]) if (r() < p) g[row][c] = ch; for (const c of [0, 1, W - 2, W - 1]) { if (r() < p) g[H - 1][c] = ch; if (r() < p) g[0][c] = ch; } }

  const HERO_COLS = [4, 6, 9, 11];

  // ---------- factions ----------
  // troops: [id, weight, max]; minions come in packs of 3–4 (a pack costs like one standard monster)
  const FACTIONS = {
    goblins: {
      name: 'Goblins', biome: 'forest', minion: 'goblin_cutter', elite: ['goblin_warchief'],
      troops: [['goblin_skulker', 3, 2], ['goblin_slinger', 3, 2], ['warg', 2, 2], ['goblin_hexer', 1, 1]],
      names: ['Goblin Ambush', 'The Briar Snare', 'Toll Gully', 'Mudfoot Camp'],
      intro: ['"TOLL!" A dozen yellow eyes glint from the brambles.', 'Goblin war-drums, close and getting closer.', 'A tripwire twangs. Somewhere, a goblin giggles.'],
      win: 'The goblins flee squealing into the briars.',
      tips: ['Goblin Cutters die to any hit. Area attacks shred them.', 'Goblins shift away when you miss them in melee.'],
    },
    beasts: {
      name: 'Beasts', biome: 'forest', minion: 'spiderling', elite: ['mossback'],
      troops: [['thorn_spider', 3, 2], ['boar', 3, 2], ['warg', 2, 2]],
      names: ['Webbed Hollow', 'The Bristling Glade', 'Fang Thicket', 'Mosshollow'],
      intro: ['The undergrowth rustles. Something big is breathing in there.', 'Webs glitter between the trees, thick as rope.', 'Hoofprints, claw marks, and a smell like wet dog.'],
      win: 'The last beast limps off into the Thornwood.',
      tips: ['Thornback Spiders web heroes in place. Kill them first or keep a save bonus handy.', 'Boars knock you prone after a long run: stand together so they can\'t build speed.'],
    },
    undead: {
      name: 'Restless Dead', biome: 'barrow', minion: 'rattlebone', elite: ['ashen_knight'],
      troops: [['barrow_archer', 3, 2], ['grave_hound', 3, 2], ['barrow_warden', 2, 1]],
      names: ['The Sunken Graves', 'Bonefield', 'The Weeping Cairns', 'Ossuary Rise'],
      intro: ['The earth splits. Bony fingers grope for the moonlight.', 'Cold mist curls between the headstones, and something rattles.', 'A bell tolls from an empty chapel.'],
      win: 'The dead lie still once more.',
      tips: ['Headstones block movement but not sight lines.', 'Radiant damage is your friend here.'],
    },
    bandits: {
      name: 'Bandits', biome: 'road', minion: 'bandit_thug', elite: ['bandit_enforcer'], object: 'oil_barrel',
      troops: [['bandit_cutthroat', 3, 2], ['bandit_xbow', 3, 2], ['bandit_bruiser', 1, 1]],
      names: ['Roadside Ambush', 'Wagon Trap', 'The Highwaymen', 'Deadman\'s Bend'],
      intro: ['"Purses on the ground, nice and slow."', 'An overturned cart blocks the road. Too neatly.', 'Crossbows creak in the treeline.'],
      win: 'The bandits scatter, leaving their loot behind.',
      tips: ['Oil barrels explode when damaged. Bandits love to stand beside them.', 'Thugs hit harder in a mob. Break them up with area attacks.'],
    },
    bakery: {
      name: 'Confections', biome: 'bakery', minion: 'gingerbread', elite: ['fondant_knight'], object: 'jam_jar', minion2: 'cream_puff',
      troops: [['macaron', 3, 2], ['cinnamon_roller', 2, 2]],
      names: ['Sugar Street', 'The Glazed Market', 'Pastry Row', 'Crumb Alley'],
      intro: ['The streets of Hollowmere smell of burnt sugar. Something marches in step.', 'A gingerbread patrol rounds the corner and halts. "HALT. YOU ARE NOT DESSERT."', 'Frosting drips from the shop signs like candle wax.'],
      win: 'Crumbs, everywhere. The patrol is no more.',
      tips: ['Cream Puffs burst when popped and slow whoever stands next to them.', 'Jam jars shatter into sticky jam that immobilizes.'],
    },
  };

  const passable = (ch, biome) => { const t = BIOMES[biome].legend[ch]; return t && !G.Engine.TERRAIN[t.terrain].block; };
  function reachable(g, biome) {
    const Hex = G.Hex, seen = new Set(), q = [Hex.fromOffset(8, 10)];
    const key = (h) => h.q + ',' + h.r;
    seen.add(key(q[0]));
    while (q.length) {
      const h = q.shift();
      for (const n of Hex.neighbors(h)) {
        const o = { col: n.q + (n.r - (n.r & 1)) / 2, row: n.r }; if (o.col < 0 || o.col >= W || o.row < 0 || o.row >= H) continue;
        if (seen.has(key(n)) || !passable(g[o.row][o.col], biome)) continue;
        seen.add(key(n)); q.push(n);
      }
    }
    return (col, row) => seen.has(key(Hex.fromOffset(col, row)));
  }

  // kind: 'combat' | 'elite'. heroes: how many heroes are still alive (the budget follows the party).
  function make(o) {
    const F = FACTIONS[o.faction], r = rng(o.seed), biome = F.biome;
    let g, ok;
    for (let tries = 0; tries < 20; tries++) {
      g = Array.from({ length: H }, () => Array(W).fill(biome === 'road' ? '.' : '.'));
      BIOMES[biome].paint(g, r);
      for (let row = 9; row < H; row++) for (let c = 2; c < W - 2; c++) if (!passable(g[row][c], biome)) g[row][c] = row === 11 && (c < 3 || c > W - 4) ? g[row][c] : '.';
      for (const c of HERO_COLS) g[10][c] = 'H';
      ok = reachable(g.map(row => row.map(ch => ch === 'H' ? '.' : ch)), biome);
      if (HERO_COLS.every(c => ok(c, 10))) break;
    }
    const legend = Object.assign({}, BIOMES[biome].legend, { 'H': L(BIOMES[biome].legend['.'].terrain, { spawn: 'hero' }) });
    const open = (row0, row1) => { const out = []; for (let row = row0; row <= row1; row++) for (let c = 1; c < W - 1; c++) { const ch = g[row][c]; if (ok(c, row) && passable(ch, biome) && !G.Engine.TERRAIN[legend[ch].terrain].hazard) out.push([c, row]); } return out; };
    const taken = new Set();
    const spot = (row0, row1) => { const cands = open(row0, row1).filter(([c, row]) => !taken.has(c + ',' + row)); if (!cands.length) return null; const s = cands[Math.floor(r() * cands.length)]; taken.add(s[0] + ',' + s[1]); return s; };

    const lvl = o.level, enemies = [];
    const add = (id, row0, row1) => { const at = spot(row0, row1); if (at) enemies.push({ id, at, lvAdj: lvl - G.Monsters[id].level }); };
    // budget in "standard monsters": about one per hero, more in later acts; an elite counts as two
    let budget = o.heroes * (o.kind === 'elite' ? 1 : 1.1) + (o.act - 1) * 0.5 + (o.extra || 0);
    if (o.kind === 'elite') { add(F.elite[Math.floor(r() * F.elite.length)], 1, 4); budget -= 2; }
    const count = {};
    const pickTroop = () => {
      const opts = F.troops.filter(([id, , max]) => (count[id] || 0) < max);
      const tot = opts.reduce((t, x) => t + x[1], 0); let k = r() * tot;
      for (const x of opts) { k -= x[1]; if (k <= 0) return x[0]; }
      return opts.length ? opts[opts.length - 1][0] : null;
    };
    let packs = 0;
    while (budget >= 0.75) {
      if (packs < 2 && (r() < 0.3 || budget < 1)) {
        const n = 3 + (r() < 0.5 ? 1 : 0), mid = F.minion2 && r() < 0.4 ? F.minion2 : F.minion;
        for (let i = 0; i < n; i++) add(mid, 2, 6);
        packs++; budget -= 1;
      } else {
        const id = pickTroop(); if (!id) { budget -= 1; continue; }
        count[id] = (count[id] || 0) + 1;
        const role = G.Monsters[id].role;
        if (/Artillery/.test(role)) add(id, 0, 2); else if (/Skirmisher|Lurker/.test(role)) add(id, 1, 5); else add(id, 2, 5);
        budget -= 1;
      }
    }
    const objects = [];
    if (F.object) for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) { const at = spot(2, 6); if (at) objects.push({ id: F.object, at }); }
    const name = F.names[Math.floor(r() * F.names.length)];
    const elite = o.kind === 'elite' ? G.Monsters[enemies[0].id] : null;
    return {
      id: 'gen', gen: true, faction: o.faction, level: lvl, deployRows: [9, 11],
      name: elite ? `${elite.name}${elite.title && elite.title !== elite.name ? ', ' + elite.title : ''}` : name,
      sub: `Level ${lvl} · ${o.kind === 'elite' ? 'Elite' : 'Party'} vs ${F.name}`,
      blurb: elite ? `${elite.desc || ''} Its retinue is close behind.`.trim() : `${F.name} bar the way.`,
      intro: F.intro[Math.floor(r() * F.intro.length)],
      winText: F.win, loseText: 'The party falls on the road. Nobody sings about it.',
      palette: BIOMES[biome].palette, legend, map: g.map(row => row.join('')), enemies, objects,
      events: o.kind === 'elite' ? [{ round: 3, msg: 'Reinforcements pour in from the far side!', spawn: [0, 1, 2].map(i => ({ id: F.minion, at: [3 + i * 5, 0], lvAdj: lvl - G.Monsters[F.minion].level })) }] : [],
      tips: F.tips,
    };
  }

  G.Encounters = { FACTIONS, BIOMES, make, rng };
})();
if (typeof module !== 'undefined') module.exports = G;
