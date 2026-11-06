// Prints a play-by-play of one AI-vs-AI game. Usage: npx tsx scripts/trace.ts deckA deckB [seed]
import { chooseAction } from '../shared/ai';
import { cardDef } from '../shared/cards';
import { Game } from '../shared/engine';

const [a = 'wildfire', b = 'silver_vanguard', seed = '1'] = process.argv.slice(2);
const g = Game.create({ name: 'A', deck: a, isAI: true }, { name: 'B', deck: b, isAI: true }, Number(seed));
let lastRound = 0;
while (g.s.phase !== 'over' && g.s.round < 30) {
  const p = g.s.phase === 'mulligan' ? g.s.players.findIndex((x) => !x.mulliganDone) : g.s.turn;
  const act = chooseAction(g, p);
  const before = g.clone();
  g.act(p, act);
  if (g.s.round !== lastRound) {
    lastRound = g.s.round;
    console.log(`\n== Round ${g.s.round}  A:${g.s.players[0].sanctum} (${g.s.players[0].maxMana} mana)  B:${g.s.players[1].sanctum} (${g.s.players[1].maxMana} mana)`);
  }
  const who = p === 0 ? 'A' : 'B';
  if (act.type === 'play') {
    const ci = before.s.players[p].hand.find((c) => c.iid === act.iid)!;
    console.log(`${who} plays ${cardDef(ci.cardId).name} ${JSON.stringify(act.targets)}`);
  } else if (act.type === 'order') {
    const u = before.unit(act.uid)!;
    const tgt = act.attack ? ('uid' in act.attack ? cardDef(before.unit(act.attack.uid)!.cardId).name : 'SANCTUM') : '';
    console.log(`${who} orders ${cardDef(u.cardId).name}(${u.atk}/${u.hp}) ${act.to ? `-> ${act.to.c},${act.to.r}` : ''} ${tgt ? 'attacks ' + tgt : ''}`);
  } else if (act.type === 'pass') console.log(`${who} passes`);
}
console.log('winner', g.s.winner, 'round', g.s.round);
