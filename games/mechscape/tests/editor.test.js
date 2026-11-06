// The content editor's file writers: saving a file nobody changed gives the
// same bytes, and an edit only touches the lines it changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/sim/load_node.js';
import { format } from '../tools/editor/format.js';
import { parseMap, writeMap } from '../tools/editor/mapfile.js';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('every data file saves back exactly as it was', () => {
  for (const dir of ['data', 'data/maps']) {
    for (const name of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.json'))) {
      const text = read(`${dir}/${name}`);
      assert.equal(format(JSON.parse(text), text), text, `${dir}/${name}`);
    }
  }
});

test('an edit rewrites only the lines it changes', () => {
  const text = read('data/items.json');
  const data = JSON.parse(text);
  data.alloy_blade.power += 1;
  data.alloy_blade.craft_xp = 3;
  const before = text.split('\n');
  const after = format(data, text).split('\n');
  assert.equal(after.length, before.length + 1);
  const changed = after.filter((line, i) => line !== before[i] && !(i > 0 && line === before[i - 1]));
  assert.ok(changed.length <= 3, changed.join('\n'));
  assert.deepEqual(JSON.parse(after.join('\n')), data);
});

test('every map saves back exactly as it was, and painting changes one character', () => {
  for (const dir of ['data/maps', 'tests/maps']) {
    for (const name of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.map'))) {
      const text = read(`${dir}/${name}`);
      assert.equal(writeMap(parseMap(text)), text, `${dir}/${name}`);
    }
  }
  const text = read('data/maps/deadfields.map');
  const map = parseMap(text);
  map.rows[5] = map.rows[5].slice(0, 10) + '=' + map.rows[5].slice(11);
  map.zones[0].x2 -= 1;
  const out = writeMap(map).split('\n');
  const changed = out.filter((line, i) => line !== text.split('\n')[i]);
  assert.equal(changed.length, 2);
});
