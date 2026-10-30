// Monsters, objects and their trait hooks. Original creatures.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const E = () => G.Engine;
  const T = G.Traits = G.Traits || {};
  const Hex = G.Hex;

  const melee = (o) => Object.assign({ tgt: 'melee', atk: { bonus: 0, vs: 'AC' } }, o);
  const ranged = (o) => Object.assign({ tgt: 'ranged', range: 10, atk: { bonus: 0, vs: 'AC' } }, o);

  G.Monsters = {
    // ---------------- Goblins (level 1 scenario) ----------------
    goblin_cutter: {
      name: 'Goblin Cutter', role: 'Minion', level: 1, minion: true, hp: 1, def: { AC: 16, Fort: 12, Ref: 14, Will: 11 }, speed: 6, init: 3,
      powers: [melee({ id: 'slash', name: 'Rusty Slash', basicMelee: true, atk: { bonus: 6, vs: 'AC' }, dmg: '4' })],
      traits: ['goblinTactics'], look: { kind: 'goblin', color: 0x6b8e23, scale: 0.8 }, ai: 'minion',
      desc: 'Dies to any hit. Ignores damage on a miss. Shifts away when you miss it in melee.',
    },
    goblin_skulker: {
      name: 'Goblin Skulker', role: 'Skirmisher', level: 1, hp: 27, def: { AC: 16, Fort: 13, Ref: 15, Will: 12 }, speed: 6, init: 5,
      powers: [melee({ id: 'stab', name: 'Notched Blade', basicMelee: true, atk: { bonus: 6, vs: 'AC' }, dmg: '1d6+2', shiftAfter: 1 })],
      traits: ['goblinTactics', 'caDamage'], caDmg: '1d6', look: { kind: 'goblin', color: 0x556b2f, scale: 0.9, hood: true }, ai: 'skirmisher',
      desc: '+1d6 damage with combat advantage. Shifts after attacking.',
    },
    goblin_slinger: {
      name: 'Goblin Slinger', role: 'Artillery', level: 1, hp: 22, def: { AC: 14, Fort: 12, Ref: 14, Will: 12 }, speed: 6, init: 3,
      powers: [
        ranged({ id: 'sling', name: 'Sling Stone', basicRanged: true, atk: { bonus: 7, vs: 'AC' }, dmg: '1d6+3' }),
        melee({ id: 'knife', name: 'Knife', basicMelee: true, atk: { bonus: 4, vs: 'AC' }, dmg: '1d4+2' }),
        ranged({ id: 'pebbles', name: 'Pebble Hail', tgt: 'areaBurst', size: 1, range: 10, recharge: 5, atk: { bonus: 5, vs: 'Ref' }, dmg: '1d6+2', targets: 'enemy' }),
      ],
      traits: ['goblinTactics'], look: { kind: 'goblin', color: 0x8fbc5a, scale: 0.8, sling: true }, ai: 'artillery',
    },
    goblin_hexer: {
      name: 'Goblin Hexer', role: 'Controller', level: 3, hp: 46, def: { AC: 17, Fort: 14, Ref: 15, Will: 16 }, speed: 6, init: 3,
      powers: [
        melee({ id: 'rod', name: 'Hexrod', basicMelee: true, atk: { bonus: 7, vs: 'AC' }, dmg: '1d6+1' }),
        ranged({ id: 'sting', name: 'Stinging Hex', atk: { bonus: 6, vs: 'Will' }, dmg: '2d6+1', hit: [{ t: 'cond', c: 'slowed' }] }),
        ranged({ id: 'cloud', name: 'Vexing Cloud', tgt: 'areaBurst', size: 1, recharge: 5, atk: { bonus: 6, vs: 'Fort' }, dmg: '1d6+1', dtype: 'poison', targets: 'enemy', hit: [{ t: 'cond', c: 'blinded' }], bark: 'Choke on it!' }),
      ],
      traits: ['goblinTactics', 'hexerSwap'], look: { kind: 'goblin', color: 0x7a5c9e, scale: 0.85, staff: true, hat: true }, ai: 'controller',
      barks: ['Hee hee! Stand still, tall-folk!', 'Cutters! Protect me!'],
      desc: 'Lead from the Rear: when hit, swaps places with an adjacent goblin minion.',
    },
    warg: {
      name: 'Scrapjaw Warg', role: 'Skirmisher', level: 2, hp: 36, def: { AC: 16, Fort: 14, Ref: 15, Will: 13 }, speed: 8, init: 5,
      powers: [melee({ id: 'bite', name: 'Savage Bite', basicMelee: true, atk: { bonus: 7, vs: 'AC' }, dmg: '1d8+3' })],
      traits: ['pounce'], look: { kind: 'wolf', color: 0x5d4e44, scale: 1 }, ai: 'skirmisher',
      desc: 'Bites with combat advantage knock the target prone.',
    },
    goblin_boss: {
      name: 'Grizzlenack the Bold', title: 'Goblin Warboss', role: 'Elite Soldier', level: 2, elite: true, hp: 70, def: { AC: 18, Fort: 15, Ref: 14, Will: 13 }, speed: 6, init: 4, saveBonus: 2, actionPoints: 1,
      powers: [
        melee({ id: 'cleaver', name: 'Big Cleaver', basicMelee: true, atk: { bonus: 7, vs: 'AC' }, dmg: '1d10+3', hit: [{ t: 'mark' }] }),
        melee({ id: 'sweep', name: 'Bully Sweep', tgt: 'closeBurst', size: 1, recharge: 5, atk: { bonus: 5, vs: 'Fort' }, dmg: '1d8+3', targets: 'enemy', hit: [{ t: 'push', n: 1 }], bark: 'GET OFF MY BRIDGE!' }),
      ],
      traits: ['goblinTactics', 'bossRally'], look: { kind: 'goblin', color: 0x4a6b1f, scale: 1.15, crown: true }, ai: 'soldier',
      barks: ['Who dares cross Grizzlenack\'s bridge?!', 'Toll is EVERYTHING you own!', 'Bah! Retreat is for cowards... and ME!'],
    },

    // ---------------- Bandits (level 3 scenario) ----------------
    bandit_thug: {
      name: 'Bandit Thug', role: 'Minion', level: 3, minion: true, hp: 1, def: { AC: 17, Fort: 15, Ref: 14, Will: 13 }, speed: 6, init: 2,
      powers: [melee({ id: 'club', name: 'Cudgel', basicMelee: true, atk: { bonus: 8, vs: 'AC' }, dmg: '5' })],
      traits: ['mobAttack'], look: { kind: 'human', color: 0x7f6a4f, scale: 0.95 }, ai: 'minion',
      desc: 'Mob Rule: +1 to hit for each other thug adjacent to the target.',
    },
    bandit_cutthroat: {
      name: 'Bandit Cutthroat', role: 'Lurker', level: 3, hp: 38, def: { AC: 17, Fort: 14, Ref: 16, Will: 14 }, speed: 6, init: 7,
      powers: [melee({ id: 'shiv', name: 'Shiv', basicMelee: true, atk: { bonus: 8, vs: 'AC' }, dmg: '1d6+3', shiftAfter: 2 })],
      traits: ['caDamage'], caDmg: '2d6', look: { kind: 'human', color: 0x2f2f3a, scale: 0.95, hood: true }, ai: 'skirmisher',
      desc: '+2d6 damage with combat advantage. Shifts 2 after attacking.',
    },
    bandit_xbow: {
      name: 'Bandit Crossbowman', role: 'Artillery', level: 3, hp: 34, def: { AC: 15, Fort: 14, Ref: 16, Will: 14 }, speed: 6, init: 4,
      powers: [
        ranged({ id: 'bolt', name: 'Crossbow Bolt', basicRanged: true, range: 15, atk: { bonus: 10, vs: 'AC' }, dmg: '1d10+4' }),
        melee({ id: 'butt', name: 'Stock Bash', basicMelee: true, atk: { bonus: 6, vs: 'AC' }, dmg: '1d6+2' }),
        ranged({ id: 'aimed', name: 'Aimed Bolt', range: 15, recharge: 5, atk: { bonus: 10, vs: 'AC' }, dmg: '2d8+4', hit: [{ t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }] }),
      ],
      look: { kind: 'human', color: 0x6a4a3a, scale: 0.95, crossbow: true }, ai: 'artillery',
    },
    bandit_bruiser: {
      name: 'Bandit Bruiser', role: 'Brute', level: 4, hp: 66, def: { AC: 16, Fort: 17, Ref: 14, Will: 14 }, speed: 5, init: 1,
      powers: [
        melee({ id: 'maul', name: 'Maul', basicMelee: true, atk: { bonus: 9, vs: 'AC' }, dmg: '2d6+4' }),
        melee({ id: 'haymaker', name: 'Haymaker', recharge: 5, atk: { bonus: 7, vs: 'Fort' }, dmg: '3d6+4', hit: [{ t: 'push', n: 2 }, { t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }], bark: 'NIGHT-NIGHT!' }),
      ],
      look: { kind: 'human', color: 0x8b4513, scale: 1.25 }, ai: 'brute', barks: ['Smash first, ask never.'],
    },
    bandit_captain: {
      name: 'Merrin the Red', title: 'Bandit Captain', role: 'Elite Soldier', level: 4, elite: true, hp: 100, def: { AC: 20, Fort: 17, Ref: 18, Will: 17 }, speed: 6, init: 7, saveBonus: 2, actionPoints: 1,
      powers: [
        melee({ id: 'rapier', name: 'Rapier', basicMelee: true, atk: { bonus: 11, vs: 'AC' }, dmg: '1d8+5', hit: [{ t: 'mark' }] }),
        melee({ id: 'flourish', name: 'Crimson Flourish', hits: 2, hitsSplit: true, recharge: 5, atk: { bonus: 11, vs: 'AC' }, dmg: '1d8+5', bark: 'Dance with me!' }),
        { id: 'rally', name: 'Rally the Crew', action: 'minor', tgt: 'closeBurst', size: 5, targets: 'ally', recharge: 5, hit: [{ t: 'cond', c: 'atkBonus', amt: 2, label: '+2 to attacks' }, { t: 'heal', amt: 5 }], bark: 'Earn your share, dogs!' },
      ],
      traits: ['riposte'], look: { kind: 'human', color: 0xb22222, scale: 1.05, cape: true, hat: true }, ai: 'soldier',
      barks: ['Your purses, your boots, and your dignity. In that order.', 'Oh, you\'re *good*. Pity.', 'Burn the wagons if you must — just get the gold!'],
      desc: 'Riposte: once per round, when missed by a melee attack, strikes back.',
    },
    oil_barrel: {
      name: 'Oil Barrel', side: 'object', role: 'Object', level: 1, hp: 1, def: { AC: 5, Fort: 5, Ref: 5, Will: 5 }, speed: 0,
      powers: [], traits: ['explosive'], look: { kind: 'barrel', color: 0x7a4a1f }, desc: 'Any damage makes it explode: 2d6+3 fire to everything within 1, and the ground burns.',
    },

    // ---------------- Pastry Golem (level 5 scenario) ----------------
    pastry_golem: {
      name: 'The Pastry Golem', title: 'Confection Abomination', role: 'Solo Brute', level: 6, solo: true, hp: 200, def: { AC: 20, Fort: 20, Ref: 17, Will: 17 }, speed: 5, init: 2, saveBonus: 5, actionPoints: 1, immuneForced: true, reach: 2,
      powers: [
        melee({ id: 'pin', name: 'Rolling Pin Smash', basicMelee: true, range: 2, atk: { bonus: 9, vs: 'AC' }, dmg: '2d6+4', hit: [{ t: 'push', n: 1 }] }),
        melee({ id: 'double', name: 'Double Batch', range: 2, hits: 2, hitsSplit: true, recharge: 5, atk: { bonus: 9, vs: 'AC' }, dmg: '1d10+4', bark: 'TWO DOZEN!' }),
        { id: 'frost', name: 'Frosting Spray', tgt: 'closeBlast', size: 3, recharge: 5, atk: { bonus: 9, vs: 'Ref' }, dmg: '1d10+4', dtype: 'cold', targets: 'enemy', hit: [{ t: 'cond', c: 'immobilized', dur: 'save', label: 'glazed (immobilized)' }], frostTiles: true, bark: 'HOLD STILL. YOU NEED... GLAZING.' },
        ranged({ id: 'sprinkle', name: 'Sprinkle Storm', tgt: 'areaBurst', size: 2, range: 10, recharge: 6, atk: { bonus: 9, vs: 'Ref' }, dmg: '1d10+4', dtype: 'fire', targets: 'enemy', hit: [{ t: 'ongoing', amt: 3, dtype: 'fire' }], bark: 'RAINBOW. JIMMIES.' }),
        { id: 'batch', name: 'Fresh Batch!', action: 'minor', tgt: 'self', recharge: 6, bark: 'OVEN ONE... OVEN TWO... DING!', text: 'Two Gingerbread Guards march out of the ovens.', after: (B, u) => { const ovens = [...B.tiles.values()].filter(t => t.terrain === 'oven'); ovens.sort(() => Math.random() - 0.5); let n = 0; for (const o of ovens) { if (n >= 2) break; const spot = Hex.neighbors(o).find(h => E().passable(B, h) && !E().unitAt(B, h) && E().tile(B, h).terrain !== 'oven'); if (spot) { E().spawnMonster(B, 'gingerbread', spot); n++; } } } },
      ],
      traits: ['pastryGolem'], look: { kind: 'golem', color: 0xf5deb3, scale: 1 }, ai: 'solo', size: 2,
      barks: ['PREHEATING... COMPLETE.', 'YOU ARE ALL... UNDERCOOKED.', 'I WILL SPRINKLE YOUR REMAINS.', 'THE CRUST... IT CRACKS...', 'ONE. FINAL. RISE.'],
      desc: 'Immune to forced movement. Reach 2. Saves +5. When bloodied it starts acting twice per round and telegraphs a Grand Soufflé; below 25% HP it frenzies.',
    },
    gingerbread: {
      name: 'Gingerbread Guard', role: 'Minion', level: 5, minion: true, hp: 1, def: { AC: 19, Fort: 17, Ref: 16, Will: 15 }, speed: 6, init: 4,
      powers: [melee({ id: 'pike', name: 'Peppermint Pike', basicMelee: true, atk: { bonus: 9, vs: 'AC' }, dmg: '5' })],
      traits: ['mobAttack'], look: { kind: 'ginger', color: 0xb5651d, scale: 0.85 }, ai: 'minion',
    },
    cream_puff: {
      name: 'Cream Puff', role: 'Minion', level: 5, minion: true, hp: 1, def: { AC: 17, Fort: 17, Ref: 15, Will: 15 }, speed: 5, init: 1,
      powers: [melee({ id: 'squish', name: 'Squish', basicMelee: true, atk: { bonus: 10, vs: 'AC' }, dmg: '6' })],
      traits: ['creamBurst'], look: { kind: 'puff', color: 0xfff5e1, scale: 0.8 }, ai: 'minion',
      desc: 'When destroyed, bursts: creatures adjacent are slowed and take 3 damage.',
    },
    macaron: {
      name: 'Macaron Mortar', role: 'Artillery', level: 5, hp: 48, def: { AC: 17, Fort: 16, Ref: 18, Will: 17 }, speed: 5, init: 4,
      powers: [
        ranged({ id: 'volley', name: 'Pastel Volley', tgt: 'areaBurst', size: 1, range: 12, recharge: 6, atk: { bonus: 9, vs: 'Ref' }, dmg: '1d8+4', targets: 'enemy' }),
        ranged({ id: 'shot', name: 'Meringue Shot', basicRanged: true, range: 12, atk: { bonus: 10, vs: 'AC' }, dmg: '1d8+3' }),
        melee({ id: 'chomp', name: 'Ganache Chomp', basicMelee: true, atk: { bonus: 9, vs: 'AC' }, dmg: '1d6+3' }),
      ],
      look: { kind: 'macaron', color: 0xf7a1c4, scale: 0.9 }, ai: 'artillery',
    },
    cinnamon_roller: {
      name: 'Cinnamon Roller', role: 'Brute', level: 5, hp: 76, def: { AC: 17, Fort: 18, Ref: 16, Will: 15 }, speed: 7, init: 3,
      powers: [melee({ id: 'slam', name: 'Glaze Slam', basicMelee: true, atk: { bonus: 10, vs: 'AC' }, dmg: '2d8+4' })],
      traits: ['rollOut'], look: { kind: 'roll', color: 0xc68642, scale: 1 }, ai: 'brute',
      desc: 'Roll Out: after moving 3+ hexes in a turn, its attacks deal +1d8 and knock prone.',
    },
    jam_jar: {
      name: 'Jam Jar', side: 'object', role: 'Object', level: 1, hp: 1, def: { AC: 5, Fort: 5, Ref: 5, Will: 5 }, speed: 0,
      powers: [], traits: ['jamBurst'], look: { kind: 'jar', color: 0xa4133c }, desc: 'Smash it: sticky jam floods every hex within 1 (difficult terrain that immobilizes).',
    },
  };

  // ---------- Monster traits ----------
  Object.assign(T, {
    goblinTactics: {
      onMissedBy: function* (B, u, att, p, ctx) {
        if (!ctx.melee || u.dead || !E().canReact(u)) return;
        const r = E().reach(B, u, 1, 'shift');
        const hexes = [...r.values()].filter(v => !v.noEnd && v.cost > 0).map(v => v.h);
        if (!hexes.length) return;
        const h = G.AI.autoShift(B, u, hexes, true);
        if (!h) return;
        E().log(B, `${u.name} scampers away (Goblin Tactics).`, 'move');
        yield* E().moveAlong(B, u, [u.pos, h], 'shift');
      },
    },
    caDamage: { dmgMod: (B, u, ctx) => ctx.ca ? E().rollDice(E().parseDice(G.Monsters[u.id].caDmg)).total : 0 },
    pounce: { onHit: function* (B, u, t, p, ctx) { if (ctx.ca && !t.dead) { E().addCond(B, t, 'prone', { dur: 'enc', src: u.uid }); E().log(B, `${t.name} is dragged down!`, 'cond'); } } },
    mobAttack: { atkMod: (B, u, ctx) => ctx.target ? B.units.filter(o => o !== u && !o.dead && o.id === u.id && Hex.dist(o.pos, ctx.target.pos) === 1).length : 0 },
    hexerSwap: {
      onHitBy: function* (B, u) {
        if (u.dead || u.turnFlags && u.turnFlags.swapped) return;
        const m = E().alliesOf(B, u).find(a => a.minion && Hex.dist(a.pos, u.pos) === 1);
        if (!m) return;
        const p = u.pos; u.pos = m.pos; m.pos = p;
        E().fx(B, { t: 'step', u: u.uid, to: u.pos, kind: 'shift' }); E().fx(B, { t: 'step', u: m.uid, to: m.pos, kind: 'shift' });
        E().log(B, `${u.name} shoves ${m.name} into harm's way!`, 'move');
      },
    },
    bossRally: {
      onBloodied: function* (B, u) {
        E().fx(B, { t: 'bark', u: u.uid, text: u.barks[2] });
        E().log(B, `${u.name} howls for help!`, 'story');
        const spots = [[1, 0], [15, 1]];
        for (const s of spots) E().spawnMonster(B, 'goblin_cutter', Hex.fromOffset(s[0], s[1]));
      },
    },
    riposte: {
      onMissedBy: function* (B, u, att, p, ctx) {
        if (!ctx.melee || u.ripRound === B.turnNo || !E().canReact(u) || att.dead || Hex.dist(att.pos, u.pos) > 1) return;
        u.ripRound = B.turnNo;
        E().fx(B, { t: 'banner', text: 'Riposte!', u: u.uid, cls: 'oa' });
        E().fx(B, { t: 'attack', u: u.uid, tgt: att.uid, kind: 'melee' });
        yield* E().attackRoll(B, u, u.powers[0], att, { melee: true });
      },
      onBloodied: function* (B, u) { E().fx(B, { t: 'bark', u: u.uid, text: u.barks[1] }); },
    },
    explosive: {
      onDeath: function* (B, u) {
        E().log(B, 'KA-BOOM! The oil barrel explodes!', 'hazard');
        E().fx(B, { t: 'explode', at: u.pos, color: 0xff7a00, r: 1 });
        const hexes = Hex.within(u.pos, 1);
        for (const h of hexes) { const t = E().tile(B, h); if (t && !E().TERRAIN[t.terrain].block) { t.terrain = 'flames'; E().fx(B, { t: 'retile', h }); } }
        for (const o of B.units.slice()) {
          if (o.dead || o === u || Hex.dist(o.pos, u.pos) > 1) continue;
          yield* E().dealDamage(B, null, o, E().rollDice(E().parseDice('2d6+3')).total, { dtype: 'fire', label: 'explosion' });
        }
      },
    },
    jamBurst: {
      onDeath: function* (B, u) {
        E().log(B, 'The jam jar shatters — sticky jam everywhere!', 'hazard');
        E().fx(B, { t: 'explode', at: u.pos, color: 0xa4133c, r: 1 });
        for (const h of Hex.within(u.pos, 1)) { const t = E().tile(B, h); if (t && !E().TERRAIN[t.terrain].block) { t.terrain = 'jam'; E().fx(B, { t: 'retile', h }); } }
        for (const o of B.units) if (!o.dead && o !== u && !o.object && Hex.dist(o.pos, u.pos) <= 1) E().addCond(B, o, 'immobilized', { dur: 'save', label: 'jammed' });
      },
    },
    creamBurst: {
      onDeath: function* (B, u) {
        E().fx(B, { t: 'explode', at: u.pos, color: 0xfffaf0, r: 1 });
        for (const o of B.units.slice()) {
          if (o.dead || o === u || o.object || o.side === u.side || Hex.dist(o.pos, u.pos) > 1) continue;
          E().addCond(B, o, 'slowed', { dur: 'save', label: 'creamed (slowed)' });
          yield* E().dealDamage(B, null, o, 3, { label: 'cream burst' });
        }
      },
    },
    rollOut: {
      dmgMod: (B, u, ctx) => (u.turnFlags && u.turnFlags.moved >= 3) ? E().rollDice(E().parseDice('1d8')).total : 0,
      onHit: function* (B, u, t) { if (u.turnFlags && u.turnFlags.moved >= 3 && !t.dead) { E().addCond(B, t, 'prone', { dur: 'enc', src: u.uid }); E().log(B, `${t.name} is bowled over!`, 'cond'); } },
    },
    pastryGolem: {
      onBattleStart: function* (B, u) { u.phase = 1; },
      skipSecond: (B, u) => u.phase < 2 ? 1 : 0, // the second turn each round unlocks when Overbaked
      onTurnStart: function* (B, u, ent) {
        // resolve telegraphed attack
        const tg = B.telegraphs.find(t => t.owner === u.uid && !t.expired);
        if (tg) {
          tg.expired = true;
          E().fx(B, { t: 'bark', u: u.uid, text: 'RISE... AND... FALL!' });
          E().log(B, 'The Grand Soufflé comes crashing down!', 'story');
          E().fx(B, { t: 'explode', at: tg.center, color: 0xffe4b5, r: tg.size, big: true });
          const p = { id: 'souffle', name: 'Grand Soufflé', atk: { bonus: 10, vs: 'Fort' }, dmg: '2d8+6', miss: 'half', hit: [{ t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }], tgt: 'areaBurst', range: 99 };
          for (const o of B.units.slice()) if (!o.dead && o.side === 'hero' && Hex.dist(o.pos, tg.center) <= tg.size) yield* E().attackRoll(B, u, p, o, { area: true });
          B.telegraphs = B.telegraphs.filter(t => t !== tg);
          if (u.dead) return;
        }
        if (u.phase >= 2 && ent && ent.second && !B.telegraphs.some(t => t.owner === u.uid)) {
          // choose densest hero cluster within 8
          let best = null, bs = 0;
          for (const h of B.units.filter(o => o.side === 'hero' && !o.dead)) {
            const n = B.units.filter(o => o.side === 'hero' && !o.dead && Hex.dist(o.pos, h.pos) <= 2).length;
            if (Hex.dist(h.pos, u.pos) <= 8 && n > bs) { bs = n; best = h.pos; }
          }
          if (best) {
            B.telegraphs.push({ owner: u.uid, center: best, size: 2, hexes: Hex.within(best, 2), name: 'Grand Soufflé' });
            E().fx(B, { t: 'telegraph' });
            E().fx(B, { t: 'banner', text: 'The Golem inhales... flour swirls!', u: u.uid, cls: 'blood' });
            E().log(B, 'WARNING: The Pastry Golem prepares a Grand Soufflé! Get out of the marked area before its next turn.', 'story');
          }
        }
      },
      onBloodied: function* (B, u) {
        u.phase = 2;
        E().fx(B, { t: 'bark', u: u.uid, text: 'THE CRUST... IT CRACKS... I AM... OVERBAKED!' });
        E().fx(B, { t: 'story', text: 'Phase 2 — Overbaked! The Golem now acts twice per round, calls cream puffs from the larder, and readies its Grand Soufflé.' });
        E().log(B, 'The Pastry Golem is OVERBAKED! It now takes two turns each round, its crust hardens (+2 AC), and it begins preparing the Grand Soufflé.', 'story');
        u.def.AC += 2;
        for (const s of [[3, 2], [13, 2], [8, 1]]) E().spawnMonster(B, 'cream_puff', Hex.fromOffset(s[0], s[1]));
      },
      onDamaged: function* (B, u) {
        if (u.phase === 2 && u.hp <= u.maxHp * 0.25) {
          u.phase = 3;
          E().fx(B, { t: 'bark', u: u.uid, text: 'ONE. FINAL. RISE.' });
          E().fx(B, { t: 'story', text: 'Phase 3 — Final Rise! The Golem collapses into a frenzy: faster, hits harder, crust crumbling.' });
          E().log(B, 'The Golem enters its FINAL RISE: +2 speed, +3 damage, but its crust crumbles (-4 AC).', 'story');
          u.speed += 2; u.def.AC -= 4; u.phase3 = true;
          for (const p of u.powers) if (p.recharge) u.recharge[p.id] = true;
        }
      },
      dmgMod: (B, u) => u.phase3 ? 3 : 0,
      onHit: function* (B, u, t, p) {
        if (p && p.frostTiles) { const tl = E().tile(B, t.pos); if (tl && ['tile', 'floor'].includes(tl.terrain)) { tl.terrain = 'frosting'; E().fx(B, { t: 'retile', h: t.pos }); } }
      },
    },
  });
})();
if (typeof module !== 'undefined') module.exports = G;
