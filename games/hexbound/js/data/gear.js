// Equipment for campaign runs: magic weapons (and implements), armor, neck slot items and trinkets, plus the
// permanent boons and curses that events hand out. G.Build.makeHero(build, level, gear) folds them into a hero.
// Enhancement follows the 4e split: the weapon slot adds to attack and damage rolls (and crits for +1d6 per
// plus), armor adds to AC, and the neck slot adds to Fortitude, Reflex and Will. All names and text are original.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const T = G.Traits = G.Traits || {};
  const E = () => G.Engine;
  const armed = (p) => p && (p.weapon || p.implement || p.basic) && !p.improvised && p.kind !== 'item';

  G.GEAR_SLOTS = {
    weapon: { name: 'Weapon', icon: '⚔', hint: 'Your weapon or implement: + to attack and damage rolls' },
    armor: { name: 'Armor', icon: '🛡', hint: '+ to AC' },
    neck: { name: 'Neck', icon: '📿', hint: '+ to Fortitude, Reflex and Will' },
    trinket: { name: 'Trinket', icon: '💍', hint: 'A ring, belt or pair of boots with a small lasting trick' },
  };

  // tier: 1 common (Act I), 2 uncommon (Act II+), 3 rare (bosses, late shops). price is the shop's asking price.
  // props: enh, speed, init, surges, hp, save, sw (Second Wind bonus), heal (healing you grant), resist {type: n},
  //        crit (extra crit dice), traits (hooks below)
  G.Gear = {
    // ---- weapons and implements ----
    w_keen: { slot: 'weapon', tier: 1, name: 'Keenwrought Arms +1', icon: '🗡', enh: 1, text: '+1 to attack and damage rolls; crits deal +1d6.', flavor: 'Plain steel, folded a hundred times by a patient smith.' },
    w_reaper: { slot: 'weapon', tier: 1, name: 'Reaper\'s Edge +1', icon: '🪓', enh: 1, traits: ['g_reaper'], text: '+1 enhancement. +2 damage against bloodied enemies.', flavor: 'It hums louder the closer the end.' },
    w_ember: { slot: 'weapon', tier: 1, name: 'Emberbrand +1', icon: '🔥', enh: 1, traits: ['g_ember'], text: '+1 enhancement. Your critical hits set the target burning (ongoing 5 fire, save ends).', flavor: 'Warm to the touch, and a little smoky in the rain.' },
    w_gravewarden: { slot: 'weapon', tier: 2, name: 'Gravewarden +1', icon: '✨', enh: 1, traits: ['g_warden'], text: '+1 enhancement. +1d8 radiant damage against undead.', flavor: 'Blessed in seven chapels and dipped in an eighth\'s font for luck.' },
    w_quick: { slot: 'weapon', tier: 2, name: 'Quicksilver Arms +1', icon: '⚡', enh: 1, init: 3, traits: ['g_quick'], text: '+1 enhancement, +3 initiative. +2 to attack rolls in the first round of a fight.', flavor: 'Always out of the scabbard a breath before you reach for it.' },
    w_storm: { slot: 'weapon', tier: 2, name: 'Stormcall Arms +2', icon: '🌩', enh: 2, text: '+2 to attack and damage rolls; crits deal +2d6.', flavor: 'The air tastes of copper when it swings.' },
    w_kingslayer: { slot: 'weapon', tier: 3, name: 'Kingslayer +2', icon: '👑', enh: 2, traits: ['g_kingslayer'], text: '+2 enhancement. +1d10 damage against elite and solo enemies.', flavor: 'Forged for a rebellion that won, then politely forgot it.' },
    w_vampiric: { slot: 'weapon', tier: 3, name: 'Thirsting Blade +2', icon: '🩸', enh: 2, traits: ['g_thirst'], text: '+2 enhancement. Once per turn, when you hit with it, gain 3 temporary HP.', flavor: 'It drinks. You try not to think about it.' },

    // ---- armor ----
    a_riveted: { slot: 'armor', tier: 1, name: 'Riveted Harness +1', icon: '🦺', enh: 1, text: '+1 AC.', flavor: 'Extra rivets where the last owner wished they\'d had them.' },
    a_emberward: { slot: 'armor', tier: 1, name: 'Emberward Coat +1', icon: '🧥', enh: 1, resist: { fire: 5 }, text: '+1 AC. Resist 5 fire.', flavor: 'Salamander-leather lining. Smells faintly of a hearth.' },
    a_briar: { slot: 'armor', tier: 2, name: 'Briarhide +1', icon: '🌿', enh: 1, traits: ['g_briar'], text: '+1 AC. An enemy that hits you with a melee attack takes 3 damage.', flavor: 'Living bark, still growing thorns.' },
    a_shroud: { slot: 'armor', tier: 2, name: 'Gravecloth Mail +1', icon: '🪦', enh: 1, resist: { necrotic: 5, cold: 5 }, text: '+1 AC. Resist 5 necrotic and 5 cold.', flavor: 'Mail woven with funeral linen. The dead don\'t like the smell.' },
    a_bulwark: { slot: 'armor', tier: 2, name: 'Bulwark Plate +2', icon: '🛡', enh: 2, text: '+2 AC.', flavor: 'Heavy enough to anchor a small boat.' },
    a_dusk: { slot: 'armor', tier: 3, name: 'Duskweave Leathers +2', icon: '🌒', enh: 2, speed: 1, text: '+2 AC, +1 speed.', flavor: 'Cut from cloth spun at twilight. You move like a rumor.' },

    // ---- neck ----
    n_pendant: { slot: 'neck', tier: 1, name: 'Warding Pendant +1', icon: '📿', enh: 1, text: '+1 Fortitude, Reflex and Will.', flavor: 'A river stone with a hole worn through by a thousand years of current.' },
    n_cloak: { slot: 'neck', tier: 1, name: 'Cloak of the Long Road +1', icon: '🧣', enh: 1, save: 1, text: '+1 Fortitude, Reflex and Will. +1 to saving throws.', flavor: 'Patched so often none of the original cloth is left.' },
    n_torc: { slot: 'neck', tier: 2, name: 'Torc of Iron Resolve +2', icon: '⭕', enh: 2, text: '+2 Fortitude, Reflex and Will.', flavor: 'Cold iron, and colder confidence.' },
    n_heartstone: { slot: 'neck', tier: 3, name: 'Heartstone Amulet +2', icon: '❤', enh: 2, sw: 5, hp: 5, text: '+2 Fortitude, Reflex and Will. +5 max HP; Second Wind heals 5 more.', flavor: 'It beats, slowly, in time with yours.' },

    // ---- trinkets ----
    t_boots: { slot: 'trinket', tier: 1, name: 'Wayfarer\'s Boots', icon: '🥾', speed: 1, text: '+1 speed.', flavor: 'Broken in by somebody else, which is the best kind.' },
    t_belt: { slot: 'trinket', tier: 1, name: 'Ox-Hide Belt', icon: '🪢', surges: 1, hp: 5, text: '+1 healing surge and +5 max HP.', flavor: 'The buckle is a tiny, very determined ox.' },
    t_luckring: { slot: 'trinket', tier: 1, name: 'Ring of Stubborn Luck', icon: '💍', save: 2, text: '+2 to saving throws.', flavor: 'Tarnished, chipped, and absolutely refuses to be lost.' },
    t_lens: { slot: 'trinket', tier: 2, name: 'Hawk\'s-Eye Lens', icon: '🔍', init: 2, traits: ['g_lens'], text: '+2 initiative and +1 to ranged and area attack rolls.', flavor: 'A sliver of crystal on a chain. Everything far away looks close.' },
    t_brooch: { slot: 'trinket', tier: 2, name: 'Mender\'s Brooch', icon: '🌼', heal: 3, sw: 3, text: 'Your healing powers restore 3 more HP; your Second Wind heals 3 more.', flavor: 'A daisy in silver. It never wilts.' },
    t_gauntlets: { slot: 'trinket', tier: 2, name: 'Gauntlets of the Ram', icon: '🧤', traits: ['g_ram'], text: '+2 damage with melee attacks.', flavor: 'The knuckles are carved like curling horns.' },
    t_phoenix: { slot: 'trinket', tier: 3, name: 'Phoenix Feather', icon: '🪶', traits: ['g_phoenix'], text: 'Once per fight, the first time you would drop to 0 HP, you stay at 1 HP instead and gain 5 temporary HP.', flavor: 'Still warm, years after it fell.' },
  };

  // permanent marks from events: boons (good) and curses (bad). Same props as gear, no slot.
  G.Boons = {
    b_vigor: { name: 'Hale', icon: '💪', hp: 5, text: '+5 max HP.' },
    b_blessed: { name: 'Blessed', icon: '🕊', save: 1, sw: 2, text: '+1 to saving throws; Second Wind heals 2 more.' },
    b_drilled: { name: 'Drilled', icon: '🎯', traits: ['g_drilled'], text: '+1 to attack rolls with weapon and implement powers.' },
    b_fleet: { name: 'Fleet-footed', icon: '🐾', speed: 1, text: '+1 speed.' },
    b_iron: { name: 'Iron Gut', icon: '🍄', surges: 1, text: '+1 healing surge.' },
    c_weary: { name: 'Bone-Weary', icon: '🥱', curse: true, surges: -1, text: 'Curse: −1 healing surge.' },
    c_hexed: { name: 'Hexed', icon: '🧿', curse: true, save: -2, text: 'Curse: −2 to saving throws.' },
    c_frail: { name: 'Frail', icon: '🥀', curse: true, hp: -5, text: 'Curse: −5 max HP.' },
  };

  // fold gear and boons into a freshly built hero (called by makeHero with the unit before its powers are concrete)
  G.applyGear = function (u, gear) {
    const list = ['weapon', 'armor', 'neck', 'trinket'].map(s => G.Gear[gear[s]]).filter(Boolean).concat((gear.boons || []).map(b => G.Boons[b]).filter(Boolean));
    for (const g of list) {
      if (g.speed) u.speed += g.speed;
      if (g.init) u.initBonus += g.init;
      if (g.surges) u.surges = Math.max(1, u.surges + g.surges);
      if (g.hp) { u.maxHp += g.hp; u.hp = u.maxHp; }
      if (g.save) u.saveBonus += g.save;
      if (g.sw) u.swBonus += g.sw;
      if (g.heal) u.healBonus += g.heal;
      if (g.resist) for (const k in g.resist) u.resist[k] = (u.resist[k] || 0) + g.resist[k];
      if (g.traits) u.traits.push(...g.traits);
    }
    u.surgeValue = Math.floor(u.maxHp / 4);
  };

  Object.assign(T, {
    g_reaper: { dmgMod: (B, u, ctx) => armed(ctx.power) && ctx.target && E().bloodied(ctx.target) ? 2 : 0 },
    g_ember: { onHit: function* (B, u, t, p, ctx, res) { if (res && res.crit && armed(p) && !t.dead) { E().addCond(B, t, 'ongoing', { dur: 'save', src: u.uid, amt: 5, dtype: 'fire' }); E().log(B, `${t.name} catches fire! (Emberbrand)`, 'cond'); } } },
    g_warden: { dmgMod: (B, u, ctx) => armed(ctx.power) && ctx.target && (ctx.target.traits || []).includes('undead') ? E().rollDice(E().parseDice('1d8')).total : 0 },
    g_quick: { atkMod: (B, u, ctx) => armed(ctx.power) && B.round <= 1 ? 2 : 0 },
    g_kingslayer: { dmgMod: (B, u, ctx) => armed(ctx.power) && ctx.target && (ctx.target.elite || ctx.target.solo) ? E().rollDice(E().parseDice('1d10')).total : 0 },
    g_thirst: { onHit: function* (B, u, t, p) { if (armed(p) && u.turnFlags.thirst !== B.turnNo) { u.turnFlags.thirst = B.turnNo; E().giveTemp(B, u, 3); } } },
    g_briar: { onHitBy: function* (B, u, att, p, ctx) { if (ctx && ctx.melee && att && !att.dead && !att.object) { E().log(B, `${att.name} is torn by Briarhide's thorns.`, 'dmg'); yield* E().dealDamage(B, u, att, 3, { label: 'thorns' }); } } },
    g_lens: { atkMod: (B, u, ctx) => ctx.power && ctx.power.kind !== 'item' && (E().powerRange(u, ctx.power).kind !== 'melee') ? 1 : 0 },
    g_ram: { dmgMod: (B, u, ctx) => ctx.power && ctx.power.dmg && E().powerRange(u, ctx.power).kind === 'melee' ? 2 : 0 },
    g_phoenix: { preventDrop: (B, u) => { if (u.used.__phoenix) return 0; u.used.__phoenix = true; E().log(B, `${u.name}'s Phoenix Feather flares! They stay on their feet.`, 'oa'); E().fx(B, { t: 'banner', text: 'Phoenix!', u: u.uid, cls: 'ap' }); E().giveTemp(B, u, 5); return 1; } },
    g_drilled: { atkMod: (B, u, ctx) => armed(ctx.power) ? 1 : 0 },
  });
})();
if (typeof module !== 'undefined') module.exports = G;
