// Heroes: ancestries, classes, subclasses, powers, feats, and the trait hooks they use.
// Mechanics follow the generic shape of 4th-edition-style play (at-will / encounter / daily powers,
// four defenses, healing surges, marks, roles). All names and text here are original.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const E = () => G.Engine;
  const mod = (s) => Math.floor((s - 10) / 2);
  const M = (u, k) => mod(u.abil[k]);
  G.Traits = G.Traits || {};
  const T = G.Traits;

  // ---------- Weapons & armor ----------
  const WEAPONS = {
    longsword: { name: 'Longsword', die: [1, 8], prof: 3 },
    greataxe: { name: 'Greataxe', die: [1, 12], prof: 2, highCrit: '1d12' },
    dagger: { name: 'Dagger', die: [1, 4], prof: 3, thrown: 5 },
    shortsword: { name: 'Short Sword', die: [1, 6], prof: 3 },
    longbow: { name: 'Longbow', die: [1, 10], prof: 2, ranged: true, range: 15 },
    twinblades: { name: 'Paired Blades', die: [1, 8], prof: 3 },
    mace: { name: 'Mace', die: [1, 8], prof: 2 },
    staff: { name: 'Quarterstaff', die: [1, 8], prof: 2 },
  };
  const ARMOR = {
    cloth: { name: 'Robes', ac: 0, light: true },
    leather: { name: 'Leather', ac: 2, light: true },
    hide: { name: 'Hide', ac: 3, light: true },
    chain: { name: 'Chainmail', ac: 6 },
    scale: { name: 'Scale', ac: 7, speed: -1 },
  };

  // ---------- Power shorthands ----------
  const melee = (o) => Object.assign({ tgt: 'melee', range: 1, weapon: true, atk: { stat: 'STR', vs: 'AC' }, dmg: '1W' }, o);
  const wpn = (o) => Object.assign({ tgt: 'melee', range: 1, weapon: true, adapt: true, atk: { stat: 'WPN', vs: 'AC' }, dmg: '1W' }, o);
  const impl = (o) => Object.assign({ tgt: 'ranged', range: 10, implement: true }, o);
  const buffAlliesVs = (amt, dur = 'eont') => ({ t: 'fn', fn: (B, u, t) => { if (t.dead) return; for (const a of E().alliesOf(B, u)) if (!a.object) E().addCond(B, a, 'atkBonus', { amt, vs: t.uid, dur, src: u.uid, stack: true }); E().log(B, `Allies gain +${amt} to attack ${t.name}.`, 'cond'); } });
  const allyCanAttack = (B, u, t) => {
    const cands = E().alliesOf(B, u).filter(a => !a.object && E().canAct(a) && a.powers.some(p => (p.basicMelee || p.basicRanged) && E().validTarget(B, a, p, t)));
    cands.sort((a, b) => (b.role === 'Striker') - (a.role === 'Striker'));
    return cands[0];
  };
  G.allyCanAttack = allyCanAttack;

  // ---------- Classes ----------
  const CLASSES = {
    fighter: {
      name: 'Fighter', role: 'Defender', hp: 15, hpLvl: 6, surges: 9, def: { Fort: 2 }, armor: 'scale', primary: ['STR', 'CON', 'WIS'],
      blurb: 'Armored bulwark. Every foe you attack is marked; if a marked foe next to you shifts away or attacks someone else, you get a free swing at it.',
      features: ['Combat Challenge', 'Combat Superiority'], traits: ['combatChallenge'], color: 0xc0392b,
      subs: {
        shield: { name: 'Shieldbearer', weapon: 'longsword', shield: 2, traits: ['shieldbearer'], blurb: 'Longsword and tower shield. +2 AC/Reflex, and allies next to you gain +1 AC.' },
        ravager: { name: 'Ravager', weapon: 'greataxe', traits: ['ravager'], blurb: 'Two-handed greataxe. +1 to hit, and when you drop a foe you cleave into another adjacent foe.' },
      },
    },
    rogue: {
      name: 'Rogue', role: 'Striker', hp: 12, hpLvl: 5, surges: 6, def: { Ref: 2 }, armor: 'leather', primary: ['DEX', 'CHA', 'STR'],
      blurb: 'Knife in the dark. Deals Sneak Attack damage once per turn whenever you have combat advantage — flank, or strike the dazed and the prone. First Strike: combat advantage against any enemy that hasn\'t had a turn yet.',
      features: ['Sneak Attack', 'First Strike'], traits: ['sneakAttack'], color: 0x2c3e50,
      subs: {
        shadow: { name: 'Shadowblade', weapon: 'dagger', traits: ['shadowblade'], blurb: 'Daggers. Sneak Attack dice become d8s.' },
        ruffian: { name: 'Ruffian', weapon: 'shortsword', traits: ['ruffian'], blurb: 'Short sword. Sneak Attack adds your STR, and you start each fight with +2 AC.' },
      },
    },
    ranger: {
      name: 'Ranger', role: 'Striker', hp: 12, hpLvl: 5, surges: 6, def: { Fort: 1, Ref: 1 }, armor: 'hide', primary: ['DEX', 'STR', 'WIS'],
      blurb: 'Relentless hunter. Mark a foe as your Quarry (minor action) to deal +1d6 damage to it once per turn. Powers work with bow or blades.',
      features: ["Hunter's Quarry"], traits: ['quarry'], color: 0x27ae60,
      subs: {
        archer: { name: 'Archer', weapon: 'longbow', traits: ['archer'], blurb: 'Longbow (range 15). +1 to hit with ranged attacks.' },
        twinblade: { name: 'Twinblade', weapon: 'twinblades', traits: ['twinblade'], blurb: 'Paired blades. +2 damage with melee weapon attacks.' },
      },
    },
    cleric: {
      name: 'Cleric', role: 'Leader', hp: 12, hpLvl: 5, surges: 7, def: { Will: 2 }, armor: 'chain', primary: ['WIS', 'STR', 'CHA'],
      blurb: 'Battle priest of the Dawn. Healing Word (twice per fight, minor action) lets an ally spend a surge from range. Prayers sear foes and shield friends.',
      features: ['Healing Word', "Healer's Lore"], traits: ['healersLore'], color: 0xf1c40f,
      subs: {
        warpriest: { name: 'Warpriest', weapon: 'mace', shield: 1, traits: ['warpriest'], blurb: 'Mace and shield. Melee hits give a nearby ally temporary HP.' },
        lightbringer: { name: 'Lightbringer', weapon: 'mace', traits: ['lightbringer'], blurb: 'Radiant focus. Ranged prayers deal +2 damage; heals are stronger.' },
      },
    },
    warlord: {
      name: 'Warlord', role: 'Leader', hp: 12, hpLvl: 5, surges: 7, def: { Fort: 1, Will: 1 }, armor: 'chain', primary: ['STR', 'INT', 'CHA'],
      blurb: 'Battlefield commander. Spends attacks to make allies strike, shields friends with temporary HP from Inspiring Word (three times per fight), and gives the party +2 initiative.',
      features: ['Inspiring Word', 'Combat Leader'], traits: ['combatLeader'], color: 0x8e44ad,
      subs: {
        tactician: { name: 'Tactician', weapon: 'longsword', shield: 1, traits: ['tactician'], blurb: 'Attacks you grant to allies gain +INT to hit.' },
        inspiring: { name: 'Inspiring', weapon: 'longsword', shield: 1, traits: ['inspiring'], blurb: 'Inspiring Word grants an extra +CHA temp HP.' },
      },
    },
    wizard: {
      name: 'Wizard', role: 'Controller', hp: 10, hpLvl: 4, surges: 6, def: { Will: 2 }, armor: 'cloth', primary: ['INT', 'CON', 'WIS'],
      blurb: 'Master of areas. Bursts and blasts hit whole crowds, scatter minions, and lock enemies down.',
      features: ['Arcane Implement'], traits: [], color: 0x2980b9,
      subs: {
        evoker: { name: 'Evoker', weapon: 'staff', traits: ['evoker'], blurb: 'Staff. +1 AC, and area/close powers deal +2 damage.' },
        hexbinder: { name: 'Hexbinder', weapon: 'staff', traits: ['hexbinder'], blurb: 'Orb. Enemies take -2 to saving throws against your effects.' },
      },
    },
  };

  // ---------- Powers ----------
  // slot: atwill | enc1 | enc3 | daily1 | daily5 | util2 | class (always known)
  const P = {};
  const add = (cls, slot, list) => list.forEach(p => { p.cls = cls; p.slot = slot; p.kind = p.kind || ({ atwill: 'atwill', enc1: 'encounter', enc3: 'encounter', daily1: 'daily', daily5: 'daily', util2: 'encounter', class: 'atwill' }[slot]); P[p.id] = p; });

  // Fighter
  add('fighter', 'atwill', [
    melee({ id: 'f_cleave', name: 'Cleaving Strike', hit: [{ t: 'fn', fn: function* (B, u, t) { const o = E().enemiesOf(B, u).find(e => e !== t && E().udist(e, u) === 1); if (o) yield* E().dealDamage(B, u, o, Math.max(1, M(u, 'STR')), { label: 'cleave' }); } }], text: 'An adjacent enemy other than the target also takes STR damage.' }),
    melee({ id: 'f_drive', name: 'Driving Strike', hit: [{ t: 'push', n: 1 }, { t: 'shift', n: 1, on: 'self' }], text: 'Push 1, then you may shift 1 to follow.' }),
    // Fighters are the reliable ones: this one lands something even on a miss
    melee({ id: 'f_measured', name: 'Grinding Blow', miss: [{ t: 'dmg', amt: (B, u) => Math.max(1, M(u, 'STR')), label: 'grinding', miss: true, desc: 'STR damage' }], text: 'Even on a miss, the target takes STR damage (minions shrug it off).' }),
    // ...and the sticky ones: a pinned foe can't shift away from its mark, so it has to walk and eat the opportunity attack
    melee({ id: 'f_pin', name: 'Hold the Line', hit: [{ t: 'cond', c: 'pinned', label: 'pinned (can\'t shift)' }], text: 'The target can\'t shift until the end of your next turn: to get away from you it has to walk, and provoke.' }),
  ]);
  add('fighter', 'enc1', [
    melee({ id: 'f_sweep', name: 'Sweeping Fall', hit: [{ t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }] }),
    melee({ id: 'f_crush', name: 'Crushing Blow', dmg: '2W', bonusDmg: (B, u, t) => t.conds.some(c => c.c === 'marked' && c.src === u.uid) ? '1W' : null, text: '+1W damage if the target is already marked by you.' }),
  ]);
  add('fighter', 'enc3', [
    melee({ id: 'f_whirl', name: 'Whirling Guard', tgt: 'closeBurst', size: 1, weapon: true, eff: [{ on: 'self', t: 'cond', c: 'defBonus', amt: 2, label: '+2 defenses' }], text: 'Strike every adjacent enemy (each one is marked), then hold your guard: +2 to all defenses until the end of your next turn.' }),
    melee({ id: 'f_hamstring', name: 'Hamstring Cut', dmg: '2W', hit: [{ t: 'cond', c: 'slowed', dur: 'save' }] }),
  ]);
  add('fighter', 'daily1', [
    melee({ id: 'f_ruin', name: 'Ruinous Strike', dmg: '3W', miss: 'half', eff: [{ t: 'mark', dur: 'save' }], text: 'Hit or miss, the target stays marked by you until it saves.' }),
    melee({ id: 'f_bastion', name: 'Iron Bastion', dmg: '2W', miss: 'half', eff: [{ on: 'self', t: 'temp', amt: (B, u) => 5 + M(u, 'CON') + u.level }, { on: 'self', t: 'cond', c: 'defBonus', amt: 1, dur: 'enc', label: '+1 defenses' }] }),
  ]);
  add('fighter', 'daily5', [
    melee({ id: 'f_quake', name: 'Earthshaker', tgt: 'closeBurst', size: 1, atk: { stat: 'STR', vs: 'Fort' }, dmg: '2W', miss: 'half', hit: [{ t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }] }),
    melee({ id: 'f_roar', name: 'Defiant Roar', tgt: 'closeBurst', size: 2, atk: { stat: 'STR', vs: 'Will' }, dmg: '1W', hit: [{ t: 'mark', dur: 'save' }], eff: [{ on: 'self', t: 'temp', amt: (B, u) => 10 + M(u, 'CON') }] }),
  ]);
  add('fighter', 'util2', [
    { id: 'f_grit', name: 'Grit Teeth', action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'temp', amt: (B, u) => 5 + u.level + M(u, 'CON') }] },
    { id: 'f_taunt', name: 'Taunting Shout', action: 'minor', tgt: 'closeBurst', size: 3, targets: 'enemy', hit: [{ t: 'mark' }], text: 'Mark every enemy within 3.' },
  ]);

  // Rogue
  add('rogue', 'atwill', [
    melee({ id: 'r_pierce', name: 'Piercing Thrust', atk: { stat: 'DEX', vs: 'Ref' } }),
    melee({ id: 'r_slip', name: 'Slip Away Strike', atk: { stat: 'DEX', vs: 'AC' }, shiftAfter: 2 }),
    melee({ id: 'r_trick', name: 'Dirty Trick', atk: { stat: 'DEX', vs: 'AC' }, hit: [{ t: 'cond', c: 'cagrant', vs: 'self', label: 'exposed to you' }] }),
    { id: 'r_toss', name: 'Knife Toss', tgt: 'ranged', range: 10, weapon: true, atk: { stat: 'DEX', vs: 'AC' }, dmg: '1W' },
  ]);
  add('rogue', 'enc1', [
    melee({ id: 'r_twist', name: 'Twisting Knife', atk: { stat: 'DEX', vs: 'AC' }, dmg: '2W', sneakAlways: true, text: 'Sneak Attack applies even without combat advantage.' }),
    melee({ id: 'r_daze', name: 'Dazing Jab', atk: { stat: 'DEX', vs: 'AC' }, hit: [{ t: 'cond', c: 'dazed' }] }),
  ]);
  add('rogue', 'enc3', [
    melee({ id: 'r_bait', name: 'Bait and Switch', atk: { stat: 'DEX', vs: 'Will' }, dmg: '2W', hit: [{ t: 'swap' }] }),
    melee({ id: 'r_crimson', name: 'Crimson Flourish', atk: { stat: 'DEX', vs: 'AC' }, dmg: '2W', hit: [{ t: 'ongoing', amt: 5 }] }),
  ]);
  add('rogue', 'daily1', [
    melee({ id: 'r_gambit', name: 'Deadly Gambit', atk: { stat: 'DEX', vs: 'AC' }, dmg: '3W', miss: 'half', critCA: 3, text: 'With combat advantage, this attack is a critical hit on a 17–20.' }),
    melee({ id: 'r_easy', name: 'Easy Target', atk: { stat: 'DEX', vs: 'AC' }, dmg: '2W', miss: 'half', hit: [{ t: 'cond', c: 'slowed', dur: 'save' }, { t: 'cond', c: 'cagrant', dur: 'save', label: 'exposed' }] }),
  ]);
  add('rogue', 'daily5', [
    melee({ id: 'r_lights', name: 'Lights Out', atk: { stat: 'DEX', vs: 'Fort' }, dmg: '2W', hit: [{ t: 'cond', c: 'stunned', dur: 'save' }], miss: [{ t: 'cond', c: 'dazed' }] }),
    melee({ id: 'r_red', name: 'Red Ruin', atk: { stat: 'DEX', vs: 'AC' }, dmg: '3W', miss: 'half', hit: [{ t: 'ongoing', amt: 10 }] }),
  ]);
  add('rogue', 'util2', [
    { id: 'r_tumble', name: 'Tumble', action: 'move', tgt: 'self', eff: [{ on: 'self', t: 'shift', n: 3 }] },
    { id: 'r_smoke', name: 'Smoke Bomb', action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'cond', c: 'defBonus', amt: 2, dur: 'eont', label: '+2 defenses' }, { on: 'self', t: 'cond', c: 'hidden', dur: 'eont', sticky: true }], text: '+2 defenses and you vanish into the smoke: your next attack before the end of your next turn has combat advantage, even after you move.' },
  ]);

  // Ranger
  add('ranger', 'class', [
    { id: 'g_quarry', name: "Hunter's Quarry", kind: 'atwill', action: 'minor', tgt: 'ranged', range: 15, targets: 'enemy', hit: [{ t: 'cond', c: 'quarry', dur: 'enc', label: 'your quarry' }], text: 'Designate an enemy as your quarry: +1d6 damage to it once per turn.', when: (B, u) => !B.units.some(x => !x.dead && x.conds.some(c => c.c === 'quarry' && c.src === u.uid)) },
  ]);
  add('ranger', 'atwill', [
    wpn({ id: 'g_twin', name: 'Paired Strike', hits: 2, noMod: true, text: 'Two attacks against the target.' }),
    wpn({ id: 'g_nimble', name: 'Nimble Shot', shiftAfter: 1 }),
    wpn({ id: 'g_pin', name: 'Pinning Shot', hit: [{ t: 'cond', c: 'slowed' }] }),
    wpn({ id: 'g_careful', name: 'Careful Aim', atk: { stat: 'WPN', vs: 'AC', bonus: 2 }, noMod: true, modVsQuarry: true, text: 'Accurate (+2). Weapon dice only, unless the target is your quarry: then full damage.' }),
  ]);
  add('ranger', 'enc1', [
    wpn({ id: 'g_fangs', name: 'Twin Fangs', hits: 2 }),
    wpn({ id: 'g_hobble', name: 'Hobbling Strike', dmg: '2W', hit: [{ t: 'cond', c: 'immobilized' }] }),
  ]);
  add('ranger', 'enc3', [
    wpn({ id: 'g_volley', name: "Hunter's Volley", tgt: 'areaBurst', range: 10, size: 1, adaptArea: true, atk: { stat: 'WPN', vs: 'Ref' } }),
    wpn({ id: 'g_cutrun', name: 'Cut and Run', hits: 2, shiftAfter: 3 }),
  ]);
  add('ranger', 'daily1', [
    wpn({ id: 'g_jaws', name: "Wolf's Jaws", hits: 2, dmg: '2W', miss: 'half' }),
    wpn({ id: 'g_splinter', name: 'Splintering Shot', dmg: '3W', miss: 'half', hit: [{ t: 'cond', c: 'atkBonus', amt: -2, dur: 'save', label: '-2 to attacks' }] }),
  ]);
  add('ranger', 'daily5', [
    wpn({ id: 'g_storm', name: 'Steel Storm', tgt: 'areaBurst', range: 10, size: 2, adaptArea: true, dmg: '2W', miss: 'half' }),
    wpn({ id: 'g_predator', name: "Predator's Mark", dmg: '3W', miss: 'half', hit: [{ t: 'cond', c: 'vuln', amt: 3, dur: 'save', label: 'vulnerable 3' }] }),
  ]);
  add('ranger', 'util2', [
    { id: 'g_fleet', name: 'Fleet Pursuit', action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'shift', n: 2 }] },
    { id: 'g_breath', name: 'Steady Breath', action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'cond', c: 'atkBonus', amt: 2, dur: 'eont', label: '+2 to attacks' }] },
  ]);

  // Cleric
  const healWord = (id, name, bonusFn) => ({ id, name, kind: 'atwill', uses: 2, action: 'minor', tgt: 'ranged', range: 5, targets: 'allyOrSelf', noProvoke: true, hit: [{ t: 'heal', surge: true, bonus: bonusFn }], text: 'Twice per fight. Target spends a healing surge and regains extra HP. Revives the dying.' });
  add('cleric', 'class', [healWord('c_word', 'Healing Word', (B, u) => E().rollDice(E().parseDice('1d6')).total + M(u, 'WIS'))]);
  add('cleric', 'atwill', [
    impl({ id: 'c_lance', name: 'Lance of Dawn', range: 5, atk: { stat: 'WIS', vs: 'Ref' }, dmg: '1d6', dtype: 'radiant', hit: [{ on: 'allyNear', prefer: 'hurt', hurtOnly: true, incSelf: true, t: 'heal', amt: (B, u) => Math.max(2, M(u, 'WIS')) }], text: 'The most wounded of you and your allies within 5 regains WIS HP (no surge).' }),
    impl({ id: 'c_lantern', name: 'Lantern Bolt', atk: { stat: 'WIS', vs: 'Will' }, dmg: '1d8', dtype: 'radiant', hit: [{ t: 'cond', c: 'atkBonus', amt: -2, label: 'dazzled (-2 to attacks)' }], text: 'The target is dazzled: -2 to attack rolls until the end of your next turn.' }),
    melee({ id: 'c_ward', name: 'Warding Strike', hit: [{ on: 'allyNear', t: 'cond', c: 'defBonus', amt: 2, label: '+2 defenses' }], text: 'An ally near the target gains +2 to all defenses.' }),
  ]);
  add('cleric', 'enc1', [
    melee({ id: 'c_mend', name: 'Mending Strike', dmg: '2W', dtype: 'radiant', eff: [{ on: 'allyNear', prefer: 'hurt', hurtOnly: true, within: 5, t: 'heal', surge: true }], text: 'Win or lose, a hurt ally within 5 spends a healing surge.' }),
    impl({ id: 'c_dawnflare', name: 'Dawnflare', atk: { stat: 'WIS', vs: 'Fort' }, dmg: '2d8', dtype: 'radiant', hit: [{ t: 'cond', c: 'dazed' }] }),
  ]);
  add('cleric', 'enc3', [
    impl({ id: 'c_halo', name: 'Searing Halo', tgt: 'closeBurst', size: 2, atk: { stat: 'WIS', vs: 'Will' }, dmg: '1d10', dtype: 'radiant', eff: [{ on: 'alliesNear', within: 2, incSelf: true, t: 'cond', c: 'defBonus', amt: 2, label: '+2 defenses' }], text: 'You and allies within 2 gain +2 to all defenses until the end of your next turn.' }),
    melee({ id: 'c_hammer', name: 'Hammer of Judgment', atk: { stat: 'STR', vs: 'Fort' }, dmg: '2W', hit: [{ t: 'push', n: 2 }, { t: 'cond', c: 'prone', dur: 'enc', label: 'knocked prone' }] }),
  ]);
  add('cleric', 'daily1', [
    impl({ id: 'c_avenging', name: 'Avenging Light', atk: { stat: 'WIS', vs: 'Ref' }, dmg: '3d8', dtype: 'radiant', miss: 'half' }),
    impl({ id: 'c_beacon', name: 'Beacon of Hope', tgt: 'closeBurst', size: 3, atk: { stat: 'WIS', vs: 'Will' }, hit: [{ t: 'cond', c: 'weakened', dur: 'save' }], eff: [{ on: 'alliesNear', within: 3, incSelf: true, t: 'heal', amt: (B, u) => 5 + M(u, 'WIS') }], text: 'Enemies are weakened; allies in range heal.' }),
  ]);
  add('cleric', 'daily5', [
    impl({ id: 'c_sunfall', name: 'Sunfall', tgt: 'areaBurst', size: 2, atk: { stat: 'WIS', vs: 'Ref' }, dmg: '2d8', dtype: 'radiant', miss: 'half', after: (B, u, ts, rs, ctx) => { for (const a of E().alliesOf(B, u, true)) if (!a.object && ctx.aim && G.Hex.dist(a.pos, ctx.aim) <= 2) E().heal(B, u, a, 5 + M(u, 'WIS') + (u.healBonus || 0)); }, text: 'Allies caught in the burst heal instead of burning.' }),
    impl({ id: 'c_chains', name: 'Blinding Radiance', atk: { stat: 'WIS', vs: 'Will' }, dmg: '2d10', dtype: 'radiant', miss: 'half', hit: [{ t: 'cond', c: 'blinded', dur: 'save' }], text: 'The target is blinded (save ends): -5 to attacks, and everyone has combat advantage against it.' }),
  ]);
  add('cleric', 'util2', [
    { id: 'c_bless', name: 'Benediction', action: 'minor', tgt: 'closeBurst', size: 5, targets: 'allyOrSelf', includeSelf: true, hit: [{ t: 'cond', c: 'defBonus', amt: 1, dur: 'enc', label: '+1 defenses' }], text: 'You and allies within 5 gain +1 to all defenses for the fight.' },
    { id: 'c_restore', name: 'Restoring Touch', tgt: 'ranged', range: 1, targets: 'allyOrSelf', noProvoke: true, hit: [{ t: 'heal', surge: true, bonus: '2d6' }, { t: 'save', bonus: 5 }] },
  ]);

  // Warlord
  // Warlords don't heal: they rally. Temp HP instead of surges (that's the Cleric's job), and a dying
  // ally is pulled back up to 1 HP first so the word still saves lives.
  add('warlord', 'class', [{ id: 'w_word', name: 'Inspiring Word', kind: 'atwill', uses: 3, action: 'minor', tgt: 'ranged', range: 5, targets: 'allyOrSelf', noProvoke: true,
    hit: [{ t: 'temp', revive: true, rally: true, amt: (B, u) => E().rollDice(E().parseDice('1d6')).total + M(u, 'CHA') + u.level + (u.traits.includes('inspiring') ? M(u, 'CHA') : 0) }],
    text: 'Three times per fight. Target gains 1d6 + CHA + level temporary HP (no surge spent). A dying target first rises at 1 HP.' }]);
  add('warlord', 'atwill', [
    { id: 'w_rally', name: 'Rally the Blade', tgt: 'ranged', range: 10, targets: 'enemy', intent: 'mixed', noProvoke: true, hit: [{ t: 'fn', fn: function* (B, u, t) { const a = allyCanAttack(B, u, t); if (!a) { E().log(B, 'No ally can reach!', 'miss'); return; } yield* E().grantAttack(B, u, a, t, { dmg: Math.max(1, M(u, 'INT')) }); } }], text: 'No attack of your own: the best-placed ally makes a basic attack on the target, +INT damage.', grant: true },
    melee({ id: 'w_heart', name: 'Heartening Strike', hit: [{ on: 'allyNear', prefer: 'hurt', t: 'temp', amt: (B, u) => M(u, 'CHA') + 2 + Math.floor(u.level / 2) }] }),
    melee({ id: 'w_opening', name: 'Opening Gambit', hit: [{ t: 'cond', c: 'cagrant', label: 'exposed to all' }], text: 'Target grants combat advantage to everyone until end of your next turn.' }),
  ]);
  add('warlord', 'enc1', [
    melee({ id: 'w_anvil', name: 'Hammer and Anvil', hit: [{ on: 'allyAdjTarget', t: 'grantAttack' }], text: 'An ally adjacent to the target makes a basic attack against it.' }),
    melee({ id: 'w_lion', name: "Lion's Command", dmg: '2W', hit: [buffAlliesVs(2)] }),
  ]);
  add('warlord', 'enc3', [
    melee({ id: 'w_shock', name: 'Shock Assault', dmg: '2W', hit: [{ t: 'cond', c: 'dazed' }, { t: 'fn', fn: function* (B, u, t) { for (const a of E().alliesOf(B, u).filter(a => !a.object && E().udist(a, t) === 1 && E().canShift(a))) yield* E().applyEffect(B, u, a, { t: 'shift', n: 1 }); } }], text: 'The target is dazed, and every ally next to it may shift 1.' }),
    melee({ id: 'w_inspblow', name: 'Inspiring Blow', dmg: '2W', hit: [{ on: 'alliesNear', incSelf: true, t: 'temp', revive: true, rally: true, amt: (B, u) => M(u, 'CHA') + 3 + u.level }], text: 'On a hit, you and allies within 5 gain CHA + 3 + level temp HP; dying allies rise at 1 HP.' }),
  ]);
  add('warlord', 'daily1', [
    melee({ id: 'w_bastion', name: 'Shieldwall Formation', dmg: '2W', miss: 'half', eff: [{ on: 'alliesNear', incSelf: true, t: 'cond', c: 'defBonus', amt: 1, dur: 'enc', label: '+1 defenses' }, { on: 'alliesNear', incSelf: true, t: 'temp', amt: 5 }] }),
    // the offensive twin of Bastion Formation: same shape (party-wide buff win or lose), but attack instead of defense
    melee({ id: 'w_lead', name: 'Lead the Charge', intent: 'mixed', dmg: '3W', miss: 'half', hit: [buffAlliesVs(2, 'enc')], eff: [{ on: 'alliesNear', incSelf: true, t: 'cond', c: 'atkBonus', amt: 1, dur: 'enc', label: '+1 to attacks' }], text: 'Win or lose, you and allies within 5 gain +1 to attacks for the fight. On a hit, allies gain +2 more against the target.' }),
  ]);
  add('warlord', 'daily5', [
    { id: 'w_grand', name: 'Grand Command', tgt: 'closeBurst', size: 5, targets: 'ally', noProvoke: true, text: 'Up to three allies within 5 each make a basic attack (+2) against an enemy they can reach.', after: function* (B, u, ts) { let n = 0; for (const a of ts) { if (n >= 3) break; const e = E().enemiesOf(B, a).filter(e => a.powers.some(p => (p.basicMelee || p.basicRanged) && E().validTarget(B, a, p, e))).sort((x, y) => x.hp - y.hp)[0]; if (e) { n++; yield* E().grantAttack(B, u, a, e, { atk: 2 }); } } } },
    melee({ id: 'w_victory', name: 'Rallying Triumph', dmg: '2W', eff: [{ on: 'alliesNear', incSelf: true, t: 'temp', revive: true, rally: true, amt: 'surgeValue' }], text: 'Win or lose, you and every ally within 5 gain temp HP equal to their surge value; dying allies rise at 1 HP.' }),
  ]);
  add('warlord', 'util2', [
    { id: 'w_orders', name: 'Quick Orders', action: 'minor', tgt: 'ranged', range: 5, targets: 'ally', noProvoke: true, hit: [{ t: 'shift', n: 2 }], text: 'An ally within 5 shifts 2 (you choose where).' },
    { id: 'w_shake', name: 'Shake It Off', action: 'minor', tgt: 'ranged', range: 5, targets: 'allyOrSelf', noProvoke: true, hit: [{ t: 'save', bonus: 2 }, { t: 'temp', amt: 5 }] },
  ]);

  // Wizard
  add('wizard', 'atwill', [
    impl({ id: 'z_dart', name: 'Arcane Dart', range: 20, atk: { stat: 'INT', vs: 'Ref' }, dmg: '2d4', dtype: 'force' }),
    impl({ id: 'z_thunder', name: 'Thunderclap', tgt: 'closeBlast', size: 3, atk: { stat: 'INT', vs: 'Fort' }, dmg: '1d6', dtype: 'thunder', hit: [{ t: 'push', n: 1 }] }),
    impl({ id: 'z_rime', name: 'Rimeburst', tgt: 'areaBurst', size: 1, atk: { stat: 'INT', vs: 'Fort' }, dmg: '1d6', dtype: 'cold', hit: [{ t: 'cond', c: 'slowed' }] }),
    impl({ id: 'z_ember', name: 'Ember Scatter', tgt: 'areaBurst', size: 2, atk: { stat: 'INT', vs: 'Ref' }, dmg: '1d4', dtype: 'fire', targets: 'enemy', text: 'Wide but weak: built for sweeping minions.' }),
  ]);
  add('wizard', 'enc1', [
    impl({ id: 'z_fan', name: 'Fan of Flame', tgt: 'closeBlast', size: 5, atk: { stat: 'INT', vs: 'Ref' }, dmg: '2d6', dtype: 'fire' }),
    impl({ id: 'z_orb', name: 'Concussive Orb', range: 20, atk: { stat: 'INT', vs: 'Fort' }, dmg: '2d8', dtype: 'force', hit: [{ t: 'fn', fn: function* (B, u, t) { for (const e of E().enemiesOf(B, u).filter(e => e !== t && E().udist(e, t) === 1)) yield* E().dealDamage(B, u, e, E().rollDice(E().parseDice('1d6')).total, { dtype: 'force', label: 'shockwave' }); } }], text: 'Enemies adjacent to the target take 1d6 force.' }),
  ]);
  add('wizard', 'enc3', [
    impl({ id: 'z_shackles', name: 'Rime Shackles', atk: { stat: 'INT', vs: 'Fort' }, dmg: '2d8', dtype: 'cold', hit: [{ t: 'cond', c: 'immobilized', dur: 'save' }] }),
    impl({ id: 'z_shock', name: 'Shock Sphere', tgt: 'areaBurst', size: 2, atk: { stat: 'INT', vs: 'Ref' }, dmg: '2d6', dtype: 'lightning' }),
  ]);
  add('wizard', 'daily1', [
    impl({ id: 'z_lullaby', name: 'Lullaby Haze', tgt: 'areaBurst', size: 2, atk: { stat: 'INT', vs: 'Will' }, targets: 'enemy', hit: [{ t: 'cond', c: 'slowed', dur: 'save', then: 'asleep', label: 'drowsy' }], miss: [{ t: 'cond', c: 'slowed' }], text: 'Slowed (save ends). On the first failed save, the target falls asleep (save ends; damage wakes it).' }),
    impl({ id: 'z_fog', name: 'Acrid Fog', tgt: 'areaBurst', size: 1, atk: { stat: 'INT', vs: 'Fort' }, dmg: '1d10', dtype: 'poison', zone: { name: 'Acrid Fog', size: 1, dmg: (B, u) => 5 + M(u, 'INT'), dtype: 'poison', rounds: 4, color: 0x7fbf3f }, text: 'Leaves a toxic cloud: enemies starting their turn in it take 5+INT poison.' }),
  ]);
  add('wizard', 'daily5', [
    impl({ id: 'z_inferno', name: 'Inferno Sphere', range: 20, tgt: 'areaBurst', size: 2, atk: { stat: 'INT', vs: 'Ref' }, dmg: '4d6', dtype: 'fire', miss: 'half' }),
    impl({ id: 'z_chain', name: 'Chained Lightning', atk: { stat: 'INT', vs: 'Ref' }, dmg: '2d8', dtype: 'lightning', miss: 'half', after: function* (B, u, ts) { const t = ts[0]; if (!t) return; const arc = Object.assign({}, P.z_chain, { dmg: '1d8', miss: null, after: null, name: 'Lightning Arc' }); const near = E().enemiesOf(B, u).filter(e => e !== t && E().udist(e, t) <= 3).slice(0, 2); for (const e of near) { E().fx(B, { t: 'attack', u: u.uid, tgt: e.uid, kind: 'ranged', dtype: 'lightning' }); yield* E().attackRoll(B, u, arc, e, {}); } }, text: 'Arcs to up to 2 more enemies within 3 of the target (1d8+INT).' }),
  ]);
  add('wizard', 'util2', [
    { id: 'z_blink', name: 'Blink Step', action: 'move', tgt: 'self', eff: [{ on: 'self', t: 'teleport', n: 4 }] },
    { id: 'z_ward', name: 'Arcane Ward', action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'cond', c: 'defBonus', amt: 4, dur: 'sont', label: '+4 defenses' }] },
  ]);

  // Ancestry powers
  P.a_breath = { id: 'a_breath', name: 'Ember Breath', kind: 'encounter', action: 'minor', tgt: 'closeBlast', size: 3, atk: { stat: 'BEST', vs: 'Ref', bonus: 2 }, dmg: '1d6', dmgMod: 'CON', dtype: 'fire', ancestry: true, noProvoke: true };

  // basic attacks for everyone
  P.basic_melee = { id: 'basic_melee', name: 'Melee Basic Attack', kind: 'basic', basicMelee: true, basic: true, tgt: 'melee', range: 1, weapon: true, atk: { stat: 'STR', vs: 'AC' }, dmg: '1W' };
  P.basic_ranged = { id: 'basic_ranged', name: 'Ranged Basic Attack', kind: 'basic', basicRanged: true, basic: true, tgt: 'ranged', range: 10, weapon: true, atk: { stat: 'DEX', vs: 'AC' }, dmg: '1W' };
  // what a hero without a bow or throwing weapon falls back on
  P.basic_stone = { id: 'basic_ranged', name: 'Thrown Stone', kind: 'basic', basicRanged: true, basic: true, improvised: true, tgt: 'ranged', range: 5, atk: { stat: 'DEX', vs: 'AC' }, dmg: '1d4', text: 'No ranged weapon: hurl whatever is to hand. No proficiency or enhancement bonus.' };

  // ---------- Ancestries ----------
  const ANCESTRIES = {
    human: { name: 'Human', bonus: { any: 2 }, speed: 6, traits: ['human'], blurb: '+2 to any one ability, a bonus feat, and +1 Fortitude, Reflex and Will.' },
    dwarf: { name: 'Dwarf', bonus: { CON: 2, WIS: 2 }, speed: 5, traits: ['dwarf'], blurb: '+2 CON, +2 WIS. Speed 5, never slowed by heavy armor. Second Wind is a minor action; reduce forced movement on you by 1.' },
    elf: { name: 'Elf', bonus: { DEX: 2, WIS: 2 }, speed: 7, traits: ['elf'], blurb: '+2 DEX, +2 WIS. Speed 7. Keen Eye: once per fight, reroll a missed attack.' },
    halfling: { name: 'Halfling', bonus: { DEX: 2, CHA: 2 }, speed: 6, traits: ['halfling'], blurb: '+2 DEX, +2 CHA. Lucky Break: the first time you are hit each fight, the attacker must reroll.' },
    emberkin: { name: 'Emberkin', bonus: { STR: 2, CHA: 2 }, speed: 6, traits: ['emberkin'], power: 'a_breath', blurb: '+2 STR, +2 CHA. Ember Breath (minor action, once per fight): close blast 3 of fire. +1 to hit while bloodied.' },
    orc: { name: 'Orc', bonus: { STR: 2, DEX: 2 }, speed: 6, traits: ['orc'], blurb: '+2 STR, +2 DEX. Relentless: the first time you would drop to 0 HP, you stay at 1 instead. +1 initiative.' },
  };

  // ---------- Feats ----------
  const FEATS = {
    toughness: { name: 'Toughness', text: '+5 maximum HP (+10 at level 5).' },
    weaponFocus: { name: 'Weapon Focus', text: '+1 damage with weapon attacks.' },
    implementFocus: { name: 'Implement Focus', text: '+1 damage with implement attacks.' },
    weaponExpertise: { name: 'Weapon Expertise', text: '+1 to hit with weapon attacks.' },
    implementExpertise: { name: 'Implement Expertise', text: '+1 to hit with implement attacks.' },
    initiative: { name: 'Quick Draw', text: '+4 initiative.' },
    reflexes: { name: 'Nimble Reflexes', text: '+2 Reflex.' },
    fortitude: { name: 'Iron Constitution', text: '+2 Fortitude.' },
    will: { name: 'Unshaken Mind', text: '+2 Will.' },
    durable: { name: 'Durable', text: '+2 healing surges.' },
    fleet: { name: 'Fleet-Footed', text: '+1 speed.' },
    executioner: { name: "Executioner's Edge", text: '+2 damage against bloodied enemies.' },
    flanker: { name: 'Pack Fighter', text: 'Combat advantage gives you +3 to hit instead of +2.' },
    deepBreath: { name: 'Deep Breath', text: 'Second Wind heals +5 HP more.' },
    healer: { name: "Mender's Touch", text: 'Your healing powers restore +3 HP; a Warlord\'s rallies grant +3 more temporary HP.', cls: ['cleric', 'warlord'] },
    backstab: { name: 'Backstabber', text: 'Sneak Attack dice increase by one size.', cls: ['rogue'] },
    lethalHunter: { name: 'Lethal Hunter', text: 'Quarry damage becomes 1d10.', cls: ['ranger'] },
    shieldPush: { name: 'Shield Push', text: 'Combat Challenge attacks push the target 1.', cls: ['fighter'] },
    sentinel: { name: 'Sentinel', text: 'Opportunity attacks gain +2 to hit and +2 damage.' },
    enlarge: { name: 'Widened Spell', text: 'Your area bursts are 1 larger.', cls: ['wizard'] },
    secondChance: { name: 'Stubborn Will', text: '+2 to saving throws (including death saves).' },
  };

  // ---------- Traits (rules hooks) ----------
  const weaponish = (p) => p && (p.weapon || p.basic);
  Object.assign(T, {
    combatChallenge: {
      afterAttack: (B, u, targets) => { for (const t of targets) if (!t.dead && !t.object) E().addCond(B, t, 'marked', { dur: 'eont', src: u.uid }); },
      atkMod: (B, u, ctx) => ctx.oa ? Math.max(0, M(u, 'WIS')) : 0,
      oaStops: () => 1,
      onEnemyAction: function* (B, u, actor, info) {
        if (u.ccRound === B.turnNo || !E().canReact(u) || actor.dead) return;
        if (!actor.conds.some(c => c.c === 'marked' && c.src === u.uid)) return;
        // a shift is judged from where it started: stepping away from the Fighter is exactly what this punishes
        if (E().udist(actor, u, info.shift && info.from ? info.from : null) !== 1) return;
        if (!(info.shift || (info.attack && !(info.targets || []).includes(u)))) return;
        u.ccRound = B.turnNo;
        E().log(B, `${u.name}'s Combat Challenge punishes ${actor.name}!`, 'oa');
        E().fx(B, { t: 'banner', text: 'Challenge!', u: u.uid, cls: 'oa' });
        E().fx(B, { t: 'attack', u: u.uid, tgt: actor.uid, kind: 'melee' });
        const bp = u.powers.find(p => p.basicMelee);
        const r = yield* E().attackRoll(B, u, bp, actor, { melee: true, challenge: true });
        if (r && r.hit && u.feats.includes('shieldPush') && !actor.dead) yield* E().forcedMove(B, u, actor, 'push', 1);
      },
    },
    shieldbearer: { auraDefAlly: (B, u, which) => which === 'AC' ? 1 : 0 },
    ravager: {
      atkMod: (B, u, ctx) => weaponish(ctx.power) ? 1 : 0,
      onKill: function* (B, u, victim) {
        if (B.active !== u || u.turnFlags.cleave || !E().canAct(u)) return;
        const o = E().enemiesOf(B, u).find(e => E().udist(e, u) === 1);
        if (!o) return; u.turnFlags.cleave = true;
        E().fx(B, { t: 'banner', text: 'Cleave!', u: u.uid, cls: 'crit' });
        E().fx(B, { t: 'attack', u: u.uid, tgt: o.uid, kind: 'melee' });
        yield* E().attackRoll(B, u, u.powers.find(p => p.basicMelee), o, { melee: true });
      },
    },
    sneakAttack: {
      dmgMod: (B, u, ctx) => {
        if (!(ctx.ca || (ctx.power && ctx.power.sneakAlways)) || !weaponish(ctx.power) || u.sneakTurn === B.turnNo) return 0;
        u.sneakTurn = B.turnNo;
        const die = (u.traits.includes('shadowblade') ? 8 : 6) + (u.feats.includes('backstab') ? 2 : 0);
        const n = 2;
        let r = E().rollDice({ dice: [[n, die]], flat: 0 }).total + (u.traits.includes('ruffian') ? Math.max(0, M(u, 'STR')) : 0);
        E().fx(B, { t: 'banner', text: 'Sneak Attack!', u: ctx.target.uid, cls: 'crit' });
        return r;
      },
      atkMod: (B, u, ctx) => (u.weapon && ['Dagger', 'Short Sword'].includes(u.weapon.name) && weaponish(ctx.power)) ? 1 : 0,
    },
    shadowblade: {},
    ruffian: { defMod: (B, u, which) => (which === 'AC' && B.round <= 1) ? 2 : 0 },
    quarry: {
      dmgMod: (B, u, ctx) => {
        if (u.quarryTurn === B.turnNo) return 0;
        if (!ctx.target.conds.some(c => c.c === 'quarry' && c.src === u.uid)) return 0;
        u.quarryTurn = B.turnNo;
        return E().rollDice({ dice: [[1, u.feats.includes('lethalHunter') ? 10 : 6]], flat: 0 }).total;
      },
    },
    archer: { atkMod: (B, u, ctx) => (ctx.power && E().powerRange(u, ctx.power).kind !== 'melee' && ctx.power.weapon) ? 1 : 0 },
    twinblade: { dmgMod: (B, u, ctx) => (ctx.power && ctx.power.weapon && E().powerRange(u, ctx.power).kind === 'melee') ? 2 : 0 },
    healersLore: {},
    warpriest: { onHit: function* (B, u, t, p) { if (p && E().powerRange(u, p).kind === 'melee') { const a = E().alliesOf(B, u).filter(a => !a.object && G.Hex.dist(a.pos, u.pos) <= 5).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]; if (a) E().giveTemp(B, a, Math.max(2, M(u, 'WIS'))); } } },
    lightbringer: { dmgMod: (B, u, ctx) => (ctx.power && ctx.power.implement && E().powerRange(u, ctx.power).kind !== 'melee') ? 2 : 0 },
    combatLeader: { allyInit: () => 2 },
    tactician: { grantAtkMod: (B, u) => Math.max(0, M(u, 'INT')) },
    inspiring: {},
    evoker: { dmgMod: (B, u, ctx) => (ctx.power && E().isArea(ctx.power) && ctx.power.kind !== 'item') ? 2 : 0 },
    hexbinder: { savePen: () => 2 },
    human: {},
    dwarf: { forcedResist: () => 1 },
    elf: { hasReroll: (B, u) => u.used.__elfReroll ? 0 : 1 },
    halfling: { canForceReroll: (B, u) => u.used.__luck ? 0 : 1 },
    emberkin: { atkMod: (B, u) => E().bloodied(u) ? 1 : 0 },
    orc: { preventDrop: (B, u) => { if (u.used.__relentless) return 0; u.used.__relentless = true; E().log(B, `${u.name} refuses to fall! (Relentless)`, 'oa'); E().fx(B, { t: 'banner', text: 'Relentless!', u: u.uid, cls: 'ap' }); return 1; } },
    // feats
    weaponFocus: { dmgMod: (B, u, ctx) => weaponish(ctx.power) ? 1 : 0 },
    implementFocus: { dmgMod: (B, u, ctx) => (ctx.power && ctx.power.implement) ? 1 : 0 },
    weaponExpertise: { atkMod: (B, u, ctx) => weaponish(ctx.power) ? 1 : 0 },
    implementExpertise: { atkMod: (B, u, ctx) => (ctx.power && ctx.power.implement) ? 1 : 0 },
    executioner: { dmgMod: (B, u, ctx) => E().bloodied(ctx.target) ? 2 : 0 },
    flanker: { caMod: () => 1 },
    sentinel: { atkMod: (B, u, ctx) => ctx.oa ? 2 : 0, dmgMod: (B, u, ctx) => ctx.oa ? 2 : 0 },
  });

  // ---------- Point buy ----------
  const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 11, 17: 14, 18: 18 };
  const BUDGET = 30;

  const Build = {
    WEAPONS, ARMOR, CLASSES, ANCESTRIES, FEATS, POWERS: P, COST, BUDGET,
    pointsSpent(base) { return G.Engine.ABIL.reduce((t, k) => t + (COST[base[k]] || 0), 0); },
    slotsFor(level) {
      return { atwill: 2, enc1: 1, enc3: level >= 3 ? 1 : 0, daily1: 1, daily5: level >= 5 ? 1 : 0, util2: level >= 2 ? 1 : 0 };
    },
    featSlots(build, level) { return 1 + (level >= 2 ? 1 : 0) + (level >= 4 ? 1 : 0) + (build.ancestry === 'human' ? 1 : 0); },
    powersOf(cls, slot) { return Object.values(P).filter(p => p.cls === cls && p.slot === slot); },
    finalAbil(build, level) {
      const a = Object.assign({}, build.base);
      const anc = ANCESTRIES[build.ancestry];
      for (const k in anc.bonus) if (k === 'any') a[build.humanBonus || CLASSES[build.cls].primary[0]] += 2; else a[k] += anc.bonus[k];
      if (level >= 4) for (const k of (build.bump4 || [])) a[k] += 1;
      return a;
    },
    // returns a concrete hero unit (without battle ids)
    // gear (campaign runs): { weapon, armor, neck, trinket, boons } item ids from js/data/gear.js. Without gear the
    // hero gets the old flat +1 enhancement from level 3 (skirmish mode); with it, enhancement comes from the gear.
    makeHero(build, level, gear) {
      const C = CLASSES[build.cls], S = C.subs[build.sub], anc = ANCESTRIES[build.ancestry];
      const abil = Build.finalAbil(build, level);
      const half = Math.floor(level / 2);
      const feats = (build.feats || []).slice(0, Build.featSlots(build, level)).filter(f => FEATS[f]);
      const gearEnh = (slot) => (gear && G.Gear && G.Gear[gear[slot]] && G.Gear[gear[slot]].enh) || 0;
      const auto = gear ? 0 : (level >= 3 ? 1 : 0);
      const enh = auto + gearEnh('weapon'), aEnh = auto + gearEnh('armor'), nEnh = auto + gearEnh('neck');
      const armor = ARMOR[C.armor];
      const weapon = Object.assign({}, WEAPONS[S.weapon]);
      const m = (k) => mod(abil[k]);
      const shield = S.shield || 0;
      const nadAnc = build.ancestry === 'human' ? 1 : 0;
      const def = {
        AC: 10 + half + armor.ac + (armor.light ? Math.max(m('DEX'), m('INT')) : 0) + shield + aEnh + (build.sub === 'evoker' ? 1 : 0),
        Fort: 10 + half + Math.max(m('STR'), m('CON')) + (C.def.Fort || 0) + nEnh + nadAnc + (feats.includes('fortitude') ? 2 : 0),
        Ref: 10 + half + Math.max(m('DEX'), m('INT')) + (C.def.Ref || 0) + shield + nEnh + nadAnc + (feats.includes('reflexes') ? 2 : 0),
        Will: 10 + half + Math.max(m('WIS'), m('CHA')) + (C.def.Will || 0) + nEnh + nadAnc + (feats.includes('will') ? 2 : 0),
      };
      let maxHp = C.hp + abil.CON + (level - 1) * C.hpLvl + (feats.includes('toughness') ? (level >= 5 ? 10 : 5) : 0);
      const surges = C.surges + Math.max(0, m('CON')) + (feats.includes('durable') ? 2 : 0);
      const speed = anc.speed + (build.ancestry === 'dwarf' ? 0 : (armor.speed || 0)) + (feats.includes('fleet') ? 1 : 0);
      // powers
      const sl = Build.slotsFor(level);
      const chosen = [];
      const pick = build.powers || {};
      const take = (slot, n) => {
        const opts = Build.powersOf(build.cls, slot);
        let ids = [].concat(pick[slot] || []).filter(id => opts.some(o => o.id === id));
        for (const o of opts) if (ids.length < n && !ids.includes(o.id)) ids.push(o.id);
        ids.slice(0, n).forEach(id => chosen.push(id));
      };
      take('atwill', sl.atwill); take('enc1', sl.enc1); take('enc3', sl.enc3); take('daily1', sl.daily1); take('daily5', sl.daily5); take('util2', sl.util2);
      Build.powersOf(build.cls, 'class').forEach(p => chosen.push(p.id));
      if (anc.power) chosen.push(anc.power);
      const u = {
        name: build.name || (anc.name + ' ' + C.name), side: 'hero', cls: build.cls, sub: build.sub, ancestry: build.ancestry,
        role: C.role, level, abil, feats, maxHp, hp: maxHp, surges, surgeValue: Math.floor(maxHp / 4),
        def, speed, weapon, enh, critDice: [enh ? enh + 'd6' : '', weapon.highCrit || ''].filter(Boolean).join('+') || null,
        traits: [].concat(C.traits, S.traits, anc.traits, feats.filter(f => T[f])),
        color: C.color, portrait: build.portrait, saveBonus: feats.includes('secondChance') ? 2 : 0,
        initBonus: (feats.includes('initiative') ? 4 : 0) + (build.ancestry === 'orc' ? 1 : 0),
        firstStrike: build.cls === 'rogue', secondWindAction: build.ancestry === 'dwarf' ? 'minor' : 'standard',
        swBonus: feats.includes('deepBreath') ? 5 : 0, healBonus: feats.includes('healer') ? 3 : 0,
        resist: {}, vuln: {}, conds: [], used: {}, uses: {}, tempHp: 0, turnFlags: {}, reach: 1, look: { cls: build.cls, sub: build.sub, color: C.color, ancestry: build.ancestry },
      };
      if (build.cls === 'cleric' && build.sub === 'lightbringer') u.healBonus += Math.max(0, m('WIS'));
      if (gear && G.applyGear) G.applyGear(u, gear);
      // lore: cleric heals +WIS already in power bonus
      // basic attacks are named for the weapon they're made with
      const basics = [Object.assign({}, P.basic_melee, { name: weapon.name }), Object.assign({}, P.basic_stone)];
      if (weapon.ranged) { basics[1] = Object.assign({}, P.basic_ranged, { range: weapon.range, name: weapon.name }); basics[0] = Object.assign({}, P.basic_melee, { name: `${weapon.name} (melee)`, dmg: '1d4', weapon: false, noWeaponDie: true, text: `A jab with the ${weapon.name.toLowerCase()}: 1d4, no weapon die.` }); }
      else if (weapon.thrown) basics[1] = Object.assign({}, P.basic_ranged, { range: weapon.thrown, name: `${weapon.name} (thrown)` });
      u.powers = basics.concat(chosen.map(id => Build.concrete(u, P[id], feats)));
      return u;
    },
    // resolve weapon adaptation so the unit holds concrete powers
    concrete(u, p, feats) {
      const c = Object.assign({}, p);
      if (c.adapt && u.weapon.ranged) {
        if (c.tgt === 'melee') { c.tgt = 'ranged'; c.range = u.weapon.range; }
        if (c.atk && c.atk.stat === 'WPN') c.atk = Object.assign({}, c.atk, { stat: 'DEX' });
      } else if (c.adapt) {
        if (c.adaptArea) { c.tgt = 'closeBurst'; c.range = 0; }
        if (c.atk && c.atk.stat === 'WPN') c.atk = Object.assign({}, c.atk, { stat: 'STR' });
      }
      if (c.atk && c.atk.stat === 'BEST') { const k = ['STR', 'CON', 'DEX'].sort((a, b) => u.abil[b] - u.abil[a])[0]; c.atk = Object.assign({}, c.atk, { stat: k }); }
      if (feats.includes('enlarge') && c.tgt === 'areaBurst') c.size = (c.size || 1) + 1;
      return c;
    },
    describe(p, u) {
      const bits = [];
      const kindName = { atwill: 'At-Will', encounter: 'Encounter', daily: 'Daily', basic: 'Basic', item: 'Consumable' }[p.kind] || p.kind;
      const act = { standard: 'Standard', move: 'Move', minor: 'Minor', free: 'Free' }[p.action || 'standard'];
      let tg = '';
      if (p.tgt === 'melee') tg = `Melee ${p.range || 1}`;
      else if (p.tgt === 'ranged') tg = p.range === 1 ? 'Touch' : `Ranged ${p.range}`;
      else if (p.tgt === 'closeBurst') tg = `Close burst ${p.size}`;
      else if (p.tgt === 'closeBlast') tg = `Close blast ${p.size}`;
      else if (p.tgt === 'areaBurst') tg = `Area burst ${p.size} within ${p.range}`;
      else if (p.tgt === 'self') tg = 'Personal';
      if (p.adapt && !u) tg += ' (or weapon range)';
      bits.push(`${kindName}${p.uses && p.kind !== 'item' ? ` (${p.uses}/fight)` : ''} · ${act} · ${tg}`);
      if (p.atk && p.kind === 'item') bits.push(`Attack: ${u ? '+' + (p.atk.bonus + u.level) : '+' + p.atk.bonus + ' + level'} vs ${p.atk.vs}`);
      else if (p.atk) {
        const st = p.atk.stat === 'WPN' ? 'STR/DEX' : p.atk.stat === 'BEST' ? 'STR/CON/DEX' : p.atk.stat;
        bits.push(`Attack: ${st}${p.atk.bonus ? ' +' + p.atk.bonus : ''} vs ${p.atk.vs}${p.hits > 1 ? ` (×${p.hits})` : ''}`);
      }
      if (p.dmg) {
        const ms = p.noMod ? '' : (p.dmgMod || (p.atk && (p.atk.stat === 'WPN' ? 'mod' : p.atk.stat === 'BEST' ? 'mod' : p.atk.stat)));
        let dm = p.dmg;
        if (u && u.weapon && /W/.test(dm)) dm += ` (${u.weapon.name} d${u.weapon.die[1]})`;
        bits.push(`Hit: ${dm}${ms ? ' + ' + ms : ''}${p.dtype ? ' ' + p.dtype : ''} damage`);
      }
      const eff = (list) => (list || []).map(e => {
        const who = e.on === 'self' ? 'you' : e.on === 'allyNear' ? 'an ally' : e.on === 'alliesNear' ? 'allies within ' + (e.within || 5) : e.on === 'allyAdjTarget' ? 'an adjacent ally' : 'target';
        const dur = { eont: '', save: ' (save ends)', enc: ' (rest of fight)', sont: ' (until your next turn)' }[e.dur || 'eont'];
        switch (e.t) {
          case 'push': case 'pull': case 'slide': return `${e.t} ${e.n}`;
          case 'cond': return `${who === 'target' ? '' : who + ': '}${e.label || e.c}${dur}`;
          case 'ongoing': return `ongoing ${e.amt} damage (save ends)`;
          case 'mark': return 'marked' + dur;
          case 'dmg': return e.desc || 'damage';
          case 'heal': return `${who} ${e.flat != null ? `spends a surge to regain ${e.flat} HP` : e.surge ? 'spends a surge' : 'heals'}`;
          case 'temp': return `${who} gains temp HP${e.revive ? ' (revives the dying)' : ''}`;
          case 'shift': return `${who} shifts ${e.n}`;
          case 'teleport': return `teleport ${e.n}`;
          case 'swap': return 'swap places';
          case 'grantAttack': return `${who} makes a basic attack`;
          case 'save': return `${who} ${e.all ? 'saves against every save-ends effect' : 'makes a saving throw'}${e.bonus ? ` (+${e.bonus})` : ''}`;
          default: return '';
        }
      }).filter(Boolean).join(', ');
      if (p.hit && p.hit.length) { const s = eff(p.hit); if (s) bits.push((p.atk ? 'Hit: ' : 'Effect: ') + s); }
      if (Array.isArray(p.miss)) bits.push('Miss: ' + eff(p.miss)); else if (p.miss === 'half') bits.push('Miss: half damage');
      if (p.eff && p.eff.length) bits.push('Effect: ' + eff(p.eff));
      if (p.shiftAfter) bits.push(`Then shift ${p.shiftAfter}`);
      if (p.text) bits.push(p.text);
      return bits;
    },
  };

  // premade parties
  Build.defaultBuild = (cls, sub, ancestry, name, base, extra = {}) => Object.assign({ name, cls, sub, ancestry, base, bump4: CLASSES[cls].primary.slice(0, 2), feats: [], powers: {} }, extra);
  Build.PREMADES = [
    {
      name: 'The Iron Lanterns', heroes: [
        Build.defaultBuild('fighter', 'shield', 'dwarf', 'Brannoc', { STR: 18, CON: 13, DEX: 10, INT: 8, WIS: 12, CHA: 8 }, { feats: ['toughness', 'shieldPush', 'sentinel'], powers: { atwill: ['f_cleave', 'f_drive'], enc1: 'f_sweep', enc3: 'f_whirl', daily1: 'f_bastion', daily5: 'f_quake', util2: 'f_taunt' } }),
        Build.defaultBuild('rogue', 'shadow', 'halfling', 'Pip Quickfingers', { STR: 8, CON: 10, DEX: 18, INT: 10, WIS: 10, CHA: 13 }, { feats: ['backstab', 'weaponFocus', 'executioner'], powers: { atwill: ['r_trick', 'r_slip'], enc1: 'r_twist', enc3: 'r_bait', daily1: 'r_easy', daily5: 'r_lights', util2: 'r_tumble' } }),
        Build.defaultBuild('cleric', 'warpriest', 'human', 'Sister Aldith', { STR: 14, CON: 11, DEX: 8, INT: 8, WIS: 18, CHA: 10 }, { humanBonus: 'WIS', feats: ['healer', 'durable', 'implementExpertise', 'will'], powers: { atwill: ['c_lance', 'c_lantern'], enc1: 'c_mend', enc3: 'c_halo', daily1: 'c_beacon', daily5: 'c_sunfall', util2: 'c_bless' } }),
        Build.defaultBuild('wizard', 'evoker', 'elf', 'Ysolde Vane', { STR: 8, CON: 13, DEX: 12, INT: 18, WIS: 10, CHA: 8 }, { feats: ['implementExpertise', 'implementFocus', 'enlarge'], powers: { atwill: ['z_rime', 'z_thunder'], enc1: 'z_fan', enc3: 'z_shock', daily1: 'z_lullaby', daily5: 'z_inferno', util2: 'z_ward' } }),
      ],
    },
    {
      name: 'Hounds of the Long Road', heroes: [
        Build.defaultBuild('fighter', 'ravager', 'orc', 'Grusha Two-Scars', { STR: 18, CON: 14, DEX: 10, INT: 8, WIS: 11, CHA: 8 }, { feats: ['weaponExpertise', 'executioner', 'toughness'], powers: { atwill: ['f_cleave', 'f_measured'], enc1: 'f_crush', enc3: 'f_hamstring', daily1: 'f_ruin', daily5: 'f_roar', util2: 'f_grit' } }),
        Build.defaultBuild('ranger', 'archer', 'elf', 'Thessaly', { STR: 12, CON: 12, DEX: 18, INT: 8, WIS: 12, CHA: 8 }, { feats: ['weaponFocus', 'lethalHunter', 'weaponExpertise'], powers: { atwill: ['g_twin', 'g_nimble'], enc1: 'g_fangs', enc3: 'g_volley', daily1: 'g_jaws', daily5: 'g_storm', util2: 'g_breath' } }),
        Build.defaultBuild('warlord', 'tactician', 'human', 'Captain Odo Venn', { STR: 16, CON: 12, DEX: 10, INT: 14, WIS: 8, CHA: 12 }, { humanBonus: 'STR', feats: ['weaponExpertise', 'healer', 'initiative', 'toughness'], powers: { atwill: ['w_rally', 'w_opening'], enc1: 'w_anvil', enc3: 'w_shock', daily1: 'w_lead', daily5: 'w_grand', util2: 'w_orders' } }),
        Build.defaultBuild('rogue', 'ruffian', 'emberkin', 'Cinder', { STR: 14, CON: 12, DEX: 16, INT: 8, WIS: 10, CHA: 12 }, { feats: ['flanker', 'weaponFocus', 'backstab'], powers: { atwill: ['r_pierce', 'r_trick'], enc1: 'r_daze', enc3: 'r_crimson', daily1: 'r_gambit', daily5: 'r_red', util2: 'r_smoke' } }),
      ],
    },
  ];

  G.Build = Build;
})();
if (typeof module !== 'undefined') module.exports = G;
