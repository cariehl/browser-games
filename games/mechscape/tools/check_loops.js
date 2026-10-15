// Checks the economy's loop rule against all game data: remove combat
// skills from the production graph, and what's left must have no cycles.
// That one rule covers "nothing feeds back into itself in fewer than three
// steps" and "every loop passes through Combat".
//
// Graph nodes are items. Each recipe adds an edge from every input to its
// output; each gather node produces its loot from nothing. Containers count
// as inputs too: a canister feeds the vent gas siphoned into it.
//
//   node tools/check_loops.js     (or npm run check-loops)
//
// Exits with code 1 (and prints each loop) if the rule is broken.

import { pathToFileURL } from 'node:url';
import { loadContentFromDisk } from '../src/sim/load_node.js';
import { Content } from '../src/sim/defs.js';
import { Skills } from '../src/sim/skills.js';

export function checkLoops() {
  loadContentFromDisk();
  const edges = new Map(); // item id -> Set of item ids it feeds
  const names = new Map();
  const producers = new Map(); // item id -> Set of skills
  const containers = [];
  const recipes = [];
  const addItem = (item) => {
    if (!edges.has(item.id)) {
      edges.set(item.id, new Set());
      producers.set(item.id, new Set());
    }
    names.set(item.id, item.display_name);
  };

  for (const def of Object.values(Content.nodes)) {
    if (Skills.COMBAT.includes(def.skill) || !def.loot) continue;
    for (const item of [...def.possibleLoot(), ...def.bonusItems()]) {
      addItem(item);
      producers.get(item.id).add(def.skill);
    }
    if (def.loot.container) {
      addItem(def.loot.container);
      edges.get(def.loot.container.id).add(def.loot.id);
      containers.push([def.loot.container, def.skill]);
    }
  }
  for (const recipe of Object.values(Content.recipes)) {
    if (Skills.COMBAT.includes(recipe.skill) || !recipe.output) continue;
    recipes.push(recipe);
    addItem(recipe.output);
    producers.get(recipe.output.id).add(recipe.skill);
    for (const input of recipe.inputs) {
      addItem(input.item);
      edges.get(input.item.id).add(recipe.output.id);
    }
  }

  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id) || []) {
      if (state.get(next) === 1) {
        cycles.push([...stack.slice(stack.indexOf(next)), next].map((i) => names.get(i) || i));
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id);

  const flow = new Map();
  const note = (from, to, what) => {
    const k = `${Skills.displayName(from)} -> ${Skills.displayName(to)}`;
    if (!flow.has(k)) flow.set(k, new Set());
    flow.get(k).add(what);
  };
  for (const recipe of recipes) {
    for (const input of recipe.inputs) {
      for (const skill of producers.get(input.item.id) || []) note(skill, recipe.skill, input.item.display_name.toLowerCase());
    }
  }
  for (const [container, skill] of containers) {
    for (const from of producers.get(container.id) || []) note(from, skill, container.display_name.toLowerCase());
  }
  const lines = [...flow].map(([k, v]) => `${k} (${[...v].join(', ')})`).sort();
  return { cycles, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { cycles, lines } = checkLoops();
  console.log('Production flow, combat removed:');
  for (const line of lines) console.log('  ' + line);
  if (cycles.length === 0) {
    console.log('OK: no production loop bypasses combat.');
  } else {
    for (const cycle of cycles) console.error('LOOP: ' + cycle.join(' -> '));
    console.error(`${cycles.length} loop(s) bypass combat. Route each one through a combat drop.`);
    process.exit(1);
  }
}
