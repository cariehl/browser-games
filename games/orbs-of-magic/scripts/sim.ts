// Plays AI-vs-AI games to sanity-check the rules and deck balance.
// Usage: npm run sim -- [gamesPerPairing]
import { chooseAction } from '../shared/ai';
import { DECKS, validateDeck } from '../shared/decks';
import { Game } from '../shared/engine';

const N = Number(process.argv[2] ?? 2);
for (const d of DECKS) { const err = validateDeck(d.cards); if (err) { console.error(`Deck ${d.id} is illegal: ${err}`); process.exit(1); } }
const wins: Record<string, { w: number; g: number }> = {};
let totalRounds = 0, games = 0, slowest = 0;
for (const a of DECKS) for (const b of DECKS) {
  if (a.id >= b.id) continue;
  for (let i = 0; i < N; i++) {
    const g = Game.create({ name: a.name, deck: a.id, isAI: true }, { name: b.name, deck: b.id, isAI: true }, (Math.random() * 1e9) | 0);
    let steps = 0;
    while (g.s.phase !== 'over' && steps < 3000) {
      const p = g.s.phase === 'mulligan' ? g.s.players.findIndex((x) => !x.mulliganDone) : g.s.turn;
      const t0 = performance.now();
      const act = chooseAction(g, p);
      slowest = Math.max(slowest, performance.now() - t0);
      const r = g.act(p, act);
      if (!r.ok) { console.error('AI chose illegal action', act, r.error); g.act(p, { type: 'pass' }); }
      steps++;
      if (g.s.round > 40) break;
    }
    games++; totalRounds += g.s.round;
    for (const d of [a, b]) wins[d.id] ??= { w: 0, g: 0 };
    wins[a.id].g++; wins[b.id].g++;
    if (g.s.winner === 0) wins[a.id].w++;
    else if (g.s.winner === 1) wins[b.id].w++;
  }
}
console.log(`games=${games} avgRounds=${(totalRounds / games).toFixed(1)} slowestDecisionMs=${slowest.toFixed(0)}`);
for (const [id, r] of Object.entries(wins).sort((x, y) => y[1].w / y[1].g - x[1].w / x[1].g)) {
  console.log(id.padEnd(20), `${((100 * r.w) / r.g).toFixed(0)}%`, `(${r.w}/${r.g})`);
}
