// Rebuilds a logged game and prints its battle log, plus the board at any point.
// Usage: npm run replay -- logs/games/<file>.jsonl [--at N] [--board]
//   --at N    stop after action N (the `i` in the log) and print the board there
//   --board   print the board at the start of every round
import { readFileSync } from 'node:fs';
import { cardDef } from '../shared/cards';
import { Game } from '../shared/engine';
import type { Action } from '../shared/types';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Usage: npm run replay -- <log file> [--at N] [--board]'); process.exit(1); }
const atIdx = args.indexOf('--at');
const stopAt = atIdx >= 0 ? Number(args[atIdx + 1]) : Infinity;
const everyRound = args.includes('--board');

type Entry =
  | { type: 'start'; seed: number; players: { name: string; deck: { id: string; name: string; cards: [string, number][] }; isAI: boolean }[]; time: string; roomId: string }
  | { type: 'action'; i: number; seat: number; round: number; action: Action; ok: boolean; error?: string }
  | { type: 'note'; text: string; time: string; error?: string }
  | { type: 'end'; winner: number | null; round: number };

const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Entry);
const start = entries.find((e) => e.type === 'start');
if (!start || start.type !== 'start') { console.error('No start entry in that log.'); process.exit(1); }
const [a, b] = start.players;
console.log(`Room ${start.roomId}, ${start.time}, seed ${start.seed}`);
console.log(`Seat 0: ${a.name} (${a.deck.name})   Seat 1: ${b.name} (${b.deck.name})`);
const g = Game.create(a, b, start.seed);

const name = (id: string) => { try { return cardDef(id).name; } catch { return id; } };
const text = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_, id) => name(id));
// The engine keeps only the last 150 log lines, so track the last one printed rather than a count.
let last: (typeof g.s.log)[number] | undefined;
function flushLog(i: number) {
  for (const l of g.s.log.slice(g.s.log.indexOf(last!) + 1)) console.log(`  #${i} [r${l.round}] ${text(l.text)}`);
  last = g.s.log[g.s.log.length - 1];
}
function board() {
  console.log(`  -- Board, round ${g.s.round}: Sanctums ${g.s.players[0].sanctum} / ${g.s.players[1].sanctum}`);
  for (const u of g.s.units) {
    const flags = [
      u.exhausted && 'exhausted', g.isFrozen(u) && `frozen until r${u.frozenUntil}`, g.isRooted(u) && 'rooted',
      u.summonedRound === g.s.round && 'summoned this round', g.canAct(u) && 'can act',
    ].filter(Boolean).join(', ');
    console.log(`     seat ${u.owner} #${u.uid} ${name(u.cardId)} ${u.atk + u.tempAtk}/${u.hp} at (${u.c},${u.r})  ${u.kw.join(' ')}  [${flags}]`);
  }
}

let round = g.s.round;
for (const e of entries) {
  if (e.type === 'note') { console.log(`  (server: ${e.text}${e.error ? `\n${e.error}` : ''})`); continue; }
  if (e.type !== 'action') continue;
  if (e.i > stopAt) break;
  const res = g.act(e.seat, e.action);
  flushLog(e.i);
  if (res.ok !== e.ok) console.log(`  !! action ${e.i} gave ok=${res.ok} on replay but ok=${e.ok} live. The replay has drifted from the real game.`);
  if (!e.ok) console.log(`  (action ${e.i} by seat ${e.seat} was rejected: ${e.error})`);
  if (everyRound && g.s.round !== round) board();
  round = g.s.round;
}
if (stopAt !== Infinity || !everyRound) board();
if (g.s.phase === 'over') console.log(`Game over: ${g.s.winner === -1 ? 'draw' : `seat ${g.s.winner} won`} in round ${g.s.round}.`);
