const fs = require('fs'), vm = require('vm'), path = require('path');
global.G = {};
for (const f of ['js/hex.js', 'js/engine.js', 'js/data/classes.js', 'js/data/monsters.js', 'js/data/scenarios.js', 'js/ai.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const E = G.Engine;
const scen = G.Scenarios.find(s => s.id === (process.argv[2] || 'golem'));
const B = E.newBattle(scen, G.Build.PREMADES[+(process.argv[3] || 0)].heroes, { seed: +(process.argv[4] || 5) });
E.runAuto(E.startBattle(B));
let turns = 0;
while (!B.over && B.round < 20 && turns < 600) {
  const u = E.runAuto(E.nextTurn(B)); if (!u) break;
  B.log.push({ msg: `>> ${u.name}'s turn (hp ${u.hp}/${u.maxHp})` });
  E.runAuto(G.AI.takeTurn(B, u)); E.runAuto(E.endTurn(B, u)); turns++;
}
console.log(B.log.map(l => l.msg).join('\n'));
