import type { Game } from './engine';
import type { CardType, Color, Keyword, Target, Unit } from './types';
import { dist, type Hex } from './hex';

export interface TargetSpec {
  kind: 'unit' | 'hex';
  side?: 'friendly' | 'enemy' | 'any';
  optional?: boolean;
  prompt: string;
  /** Extra condition on a unit target. `prev` holds the targets picked so far (for units, prev[0] is the deploy hex). */
  filter?: (g: Game, u: Unit, p: number, prev: Target[]) => boolean;
  /** Condition on a hex target (hex targets must always be empty). */
  hexFilter?: (g: Game, h: Hex, p: number, prev: Target[]) => boolean;
}

export interface PlayCtx { p: number; targets: Target[]; self?: Unit }

export interface CardDef {
  id: string;
  name: string;
  color: Color;
  type: CardType;
  cost: number;
  atk?: number;
  hp?: number;
  speed?: number;
  range?: number;
  kw?: Keyword[];
  text: string;
  flavor?: string;
  icon: string;
  token?: boolean;
  /** Extra targets. For units these come after the deploy hex. */
  targets?: TargetSpec[];
  /** Spells / orders: the effect. Units: the Arrival effect. */
  onPlay?: (g: Game, ctx: PlayCtx) => void;
  /** Last Breath (unit is already removed from the board). */
  onDeath?: (g: Game, self: Unit) => void;
  /** Another unit died while this one is on the board. */
  onUnitDeath?: (g: Game, self: Unit, dead: Unit) => void;
  onRoundStart?: (g: Game, self: Unit) => void;
  onRoundEnd?: (g: Game, self: Unit) => void;
  /** This unit took damage and survived. */
  onDamaged?: (g: Game, self: Unit, amount: number) => void;
  /** This unit was attacked by `attacker` (after combat damage). */
  onAttacked?: (g: Game, self: Unit, attacker: Unit) => void;
  /** Another friendly unit was summoned. */
  onFriendlySummon?: (g: Game, self: Unit, other: Unit) => void;
  /** Its owner played a spell or order. */
  onSpellCast?: (g: Game, self: Unit, cardId: string) => void;
  /** Spells and orders of the owner cost this much less. */
  spellDiscount?: number;
  /** AI hint: how much the card likes to be played (added to evaluation). */
  aiBias?: number;
}

const friendlyUnit = (prompt = 'Choose a friendly unit'): TargetSpec => ({ kind: 'unit', side: 'friendly', prompt });
const enemyUnit = (prompt = 'Choose an enemy unit'): TargetSpec => ({ kind: 'unit', side: 'enemy', prompt });
const anyUnit = (prompt = 'Choose a unit'): TargetSpec => ({ kind: 'unit', side: 'any', prompt });
const hexOf = (t: Target): Hex | undefined => (t && 'c' in t ? { c: t.c, r: t.r } : undefined);
const adjToDeploy = (g: Game, u: Unit, _p: number, prev: Target[]) => { const h = hexOf(prev[0]); return !!h && dist(h, u) === 1; };

const list: CardDef[] = [
  // ───────────────────────────── EMBER ─────────────────────────────
  // Passion, freedom, fury. Wins fast: Swift units, Siege, burn straight to the face.
  { id: 'e_spark_imp', name: 'Spark Imp', color: 'ember', type: 'unit', cost: 1, atk: 2, hp: 1, kw: ['swift'], icon: '👺',
    text: '', flavor: 'It has never once considered the consequences.' },
  { id: 'e_cinder_scout', name: 'Cinder Scout', color: 'ember', type: 'unit', cost: 1, atk: 1, hp: 2, speed: 3, icon: '🏃',
    text: 'Arrival: Deal 1 damage to the enemy Sanctum.',
    onPlay: (g, { p }) => g.damageSanctum(1 - p, 1) },
  { id: 'e_firebolt', name: 'Firebolt', color: 'ember', type: 'spell', cost: 1, icon: '☄️',
    text: 'Deal 2 damage to a unit.', targets: [anyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.dealDamage(u, 2, null, 'fire'); } },
  { id: 'e_torch_raider', name: 'Torch Raider', color: 'ember', type: 'unit', cost: 2, atk: 2, hp: 2, kw: ['swift', 'siege'], icon: '🔥',
    text: '', flavor: 'Burn the gates. Then burn what is behind them.' },
  { id: 'e_ashfang', name: 'Ashfang Wolf', color: 'ember', type: 'unit', cost: 2, atk: 3, hp: 2, speed: 3, icon: '🐺', text: '' },
  { id: 'e_powder_goblin', name: 'Powder Goblin', color: 'ember', type: 'unit', cost: 2, atk: 2, hp: 1, kw: ['swift'], icon: '💣',
    text: 'Last Breath: Deal 2 damage to all adjacent units.',
    onDeath: (g, self) => { g.fx('explosion', self); for (const u of g.adjacentUnits(self)) g.dealDamage(u, 2, null); } },
  { id: 'e_flame_dancer', name: 'Flame Dancer', color: 'ember', type: 'unit', cost: 2, atk: 2, hp: 2, icon: '💃',
    text: 'Whenever you cast a spell or order, deal 1 damage to the enemy Sanctum.',
    onSpellCast: (g, self) => g.damageSanctum(1 - self.owner, 1, self) },
  { id: 'e_berserker', name: 'Bloodrage Berserker', color: 'ember', type: 'unit', cost: 3, atk: 3, hp: 3, icon: '🪓',
    text: 'When this survives damage, it gets +2 power.',
    onDamaged: (g, self) => g.buff(self, 2, 0) },
  { id: 'e_pyromancer', name: 'Pyromancer', color: 'ember', type: 'unit', cost: 3, atk: 2, hp: 2, range: 2, icon: '🧙',
    text: 'Arrival: Deal 1 damage to an enemy unit.', targets: [{ ...enemyUnit(), optional: true }],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.dealDamage(u, 1, null, 'fire'); } },
  { id: 'e_war_cry', name: 'War Cry', color: 'ember', type: 'order', cost: 2, icon: '📯',
    text: 'Ready a friendly unit. It gets +2 power this round.', targets: [friendlyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.ready(u); g.tempBuff(u, 2); } } },
  { id: 'e_blitz', name: 'Blitz', color: 'ember', type: 'order', cost: 1, icon: '⚡',
    text: 'Give a friendly unit Swift and +1/+0.', targets: [friendlyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.giveKw(u, 'swift'); g.buff(u, 1, 0); } } },
  { id: 'e_warlord', name: 'Ember Warlord', color: 'ember', type: 'unit', cost: 4, atk: 4, hp: 3, icon: '👹',
    text: 'Arrival: Other friendly units get +1/+0.',
    onPlay: (g, { p, self }) => { for (const u of g.unitsOf(p)) if (u !== self) g.buff(u, 1, 0); } },
  { id: 'e_scorch', name: 'Scorch the Earth', color: 'ember', type: 'spell', cost: 3, icon: '🌋',
    text: 'Deal 3 damage to the enemy Sanctum.',
    onPlay: (g, { p }) => g.damageSanctum(1 - p, 3) },
  { id: 'e_fireball', name: 'Fireball', color: 'ember', type: 'spell', cost: 4, icon: '💥',
    text: 'Deal 4 damage to a unit and 1 damage to units adjacent to it.', targets: [anyUnit()],
    onPlay: (g, { targets }) => {
      const u = g.tUnit(targets[0]); if (!u) return;
      const adj = g.adjacentUnits(u);
      g.dealDamage(u, 4, null, 'explosion');
      for (const a of adj) g.dealDamage(a, 1, null);
    } },
  { id: 'e_phoenix', name: 'Ashen Phoenix', color: 'ember', type: 'unit', cost: 5, atk: 4, hp: 3, kw: ['flying', 'swift'], icon: '🐦‍🔥',
    text: 'Last Breath: Return a copy of this to your hand. It costs 1 more.',
    onDeath: (g, self) => g.addToHand(self.owner, 'e_phoenix', 1) },
  { id: 'e_colossus', name: 'Magma Colossus', color: 'ember', type: 'unit', cost: 6, atk: 6, hp: 6, kw: ['siege'], icon: '🗿',
    text: 'Arrival: Deal 2 damage to all adjacent enemy units.',
    onPlay: (g, { self }) => { if (!self) return; g.fx('explosion', self); for (const u of g.adjacentUnits(self)) if (u.owner !== self.owner) g.dealDamage(u, 2, null); } },

  // ───────────────────────────── TIDE ─────────────────────────────
  // Insight, patience, control. Freezes, bounces and pushes enemies around while drawing cards.
  { id: 't_coral_sentry', name: 'Coral Sentry', color: 'tide', type: 'unit', cost: 1, atk: 1, hp: 3, kw: ['guardian'], icon: '🐚', text: '' },
  { id: 't_undertow', name: 'Undertow', color: 'tide', type: 'spell', cost: 1, icon: '🌀',
    text: 'Move a unit to an empty adjacent hex.',
    targets: [anyUnit(), { kind: 'hex', prompt: 'Choose an adjacent empty hex', hexFilter: (g, h, _p, prev) => { const u = g.tUnit(prev[0]); return !!u && dist(u, h) === 1; } }],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); const h = hexOf(targets[1]); if (u && h) g.teleport(u, h); } },
  { id: 't_frostbolt', name: 'Frostbolt', color: 'tide', type: 'spell', cost: 2, icon: '❄️',
    text: 'Deal 1 damage to a unit and Freeze it.', targets: [anyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.dealDamage(u, 1, null, 'frost'); if (u.hp > 0) g.freeze(u); } } },
  { id: 't_mistling', name: 'Mistling', color: 'tide', type: 'unit', cost: 2, atk: 1, hp: 2, kw: ['flying'], icon: '🫧',
    text: 'Arrival: Draw a card.', onPlay: (g, { p }) => g.draw(p, 1) },
  { id: 't_wave_rider', name: 'Wave Rider', color: 'tide', type: 'unit', cost: 2, atk: 2, hp: 2, kw: ['flying'], speed: 3, icon: '🐬', text: '' },
  { id: 't_insight', name: 'Arcane Insight', color: 'tide', type: 'spell', cost: 3, icon: '📘',
    text: 'Draw 2 cards.', onPlay: (g, { p }) => g.draw(p, 2) },
  { id: 't_riptide', name: 'Riptide', color: 'tide', type: 'spell', cost: 3, icon: '🌊',
    text: "Return a unit to its owner's hand.", targets: [anyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.bounce(u); } },
  { id: 't_mirror_mage', name: 'Mirror Mage', color: 'tide', type: 'unit', cost: 3, atk: 2, hp: 3, range: 2, icon: '🔮',
    text: 'Arrival: Draw a card.', onPlay: (g, { p }) => g.draw(p, 1) },
  { id: 't_sea_witch', name: 'Sea Witch', color: 'tide', type: 'unit', cost: 3, atk: 2, hp: 4, icon: '🧜‍♀️',
    text: 'Your spells and orders cost 1 less.', spellDiscount: 1 },
  { id: 't_glacial', name: 'Glacial Elemental', color: 'tide', type: 'unit', cost: 4, atk: 3, hp: 5, kw: ['guardian'], icon: '🧊',
    text: 'When a unit attacks this, Freeze the attacker.',
    onAttacked: (g, _self, attacker) => { if (attacker.hp > 0) g.freeze(attacker); } },
  { id: 't_deep_freeze', name: 'Deep Freeze', color: 'tide', type: 'spell', cost: 4, icon: '🥶',
    text: 'Freeze an enemy unit and all enemy units adjacent to it.', targets: [enemyUnit()],
    onPlay: (g, { targets, p }) => {
      const u = g.tUnit(targets[0]); if (!u) return;
      g.fx('frost', u);
      for (const a of [u, ...g.adjacentUnits(u)]) if (a.owner !== p) g.freeze(a);
    } },
  { id: 't_stormcaller', name: 'Storm Caller', color: 'tide', type: 'unit', cost: 5, atk: 3, hp: 4, range: 3, icon: '⛈️',
    text: 'Arrival: Deal 2 damage to an enemy unit.', targets: [{ ...enemyUnit(), optional: true }],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.dealDamage(u, 2, null, 'lightning'); } },
  { id: 't_time_warp', name: 'Time Warp', color: 'tide', type: 'order', cost: 6, icon: '⏳',
    text: 'Ready all friendly units.',
    onPlay: (g, { p }) => { for (const u of g.unitsOf(p)) g.ready(u); } },
  { id: 't_tidal_wave', name: 'Tidal Wave', color: 'tide', type: 'spell', cost: 6, icon: '🌊',
    text: "Return all units with 3 or less power to their owners' hands.",
    onPlay: (g) => { g.fx('wave', null); for (const u of [...g.s.units]) if (g.power(u) <= 3) g.bounce(u); } },
  { id: 't_leviathan', name: 'Abyssal Leviathan', color: 'tide', type: 'unit', cost: 8, atk: 7, hp: 8, icon: '🐋',
    text: 'Arrival: Freeze all enemy units.',
    onPlay: (g, { p }) => { g.fx('wave', null); for (const u of g.unitsOf(1 - p)) g.freeze(u); } },

  // ───────────────────────────── GROVE ─────────────────────────────
  // Life, growth, endurance. Ramps mana into enormous creatures that heal themselves.
  { id: 'g_sproutling', name: 'Sproutling', color: 'grove', type: 'unit', cost: 1, atk: 0, hp: 3, kw: ['guardian'], icon: '🌱',
    text: 'Last Breath: Gain an empty mana crystal.', onDeath: (g, self) => g.gainMaxMana(self.owner, 1) },
  { id: 'g_entangle', name: 'Entangle', color: 'grove', type: 'spell', cost: 1, icon: '🕸️',
    text: "Root an enemy unit until the end of next round (it can't move).", targets: [enemyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.root(u, 2); } },
  { id: 'g_druid', name: 'Grove Druid', color: 'grove', type: 'unit', cost: 2, atk: 1, hp: 3, icon: '🧝',
    text: 'Arrival: Gain an empty mana crystal.', onPlay: (g, { p }) => g.gainMaxMana(p, 1) },
  { id: 'g_boar', name: 'Thornback Boar', color: 'grove', type: 'unit', cost: 2, atk: 2, hp: 3, icon: '🐗',
    text: 'When a unit attacks this, deal 1 damage to the attacker.',
    onAttacked: (g, _self, attacker) => { if (attacker.hp > 0) g.dealDamage(attacker, 1, null); } },
  { id: 'g_feral', name: 'Feral Growth', color: 'grove', type: 'order', cost: 2, icon: '💪',
    text: 'Give a friendly unit +2/+2.', targets: [friendlyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) g.buff(u, 2, 2); } },
  { id: 'g_pounce', name: "Predator's Pounce", color: 'grove', type: 'order', cost: 2, icon: '🐾',
    text: 'A friendly unit and an enemy unit within 2 hexes of it deal damage to each other.',
    targets: [friendlyUnit(), { ...enemyUnit(), filter: (g, u, _p, prev) => { const f = g.tUnit(prev[0]); return !!f && dist(f, u) <= 2; } }],
    onPlay: (g, { targets }) => { const a = g.tUnit(targets[0]); const b = g.tUnit(targets[1]); if (a && b) g.fight(a, b); } },
  { id: 'g_overgrowth', name: 'Overgrowth', color: 'grove', type: 'spell', cost: 3, icon: '🌿',
    text: 'Gain an empty mana crystal. Draw a card.', onPlay: (g, { p }) => { g.gainMaxMana(p, 1); g.draw(p, 1); } },
  { id: 'g_treant', name: 'Treant Warden', color: 'grove', type: 'unit', cost: 3, atk: 2, hp: 5, kw: ['guardian', 'regenerate'], icon: '🌳', text: '' },
  { id: 'g_sporecap', name: 'Sporecap Shaman', color: 'grove', type: 'unit', cost: 3, atk: 2, hp: 3, icon: '🍄',
    text: 'At the end of each round, give another random friendly unit +1/+1.',
    onRoundEnd: (g, self) => { const o = g.unitsOf(self.owner).filter((u) => u !== self); if (o.length) g.buff(g.pick(o), 1, 1); } },
  { id: 'g_stag', name: 'Elder Stag', color: 'grove', type: 'unit', cost: 4, atk: 4, hp: 4, speed: 3, icon: '🦌',
    text: 'Arrival: Other friendly units get +1/+1.',
    onPlay: (g, { p, self }) => { for (const u of g.unitsOf(p)) if (u !== self) g.buff(u, 1, 1); } },
  { id: 'g_packmother', name: 'Packmother', color: 'grove', type: 'unit', cost: 4, atk: 3, hp: 3, icon: '🦊',
    text: 'Arrival: Summon two 2/1 Wolf Pups next to this.',
    onPlay: (g, { self }) => { if (!self) return; for (let i = 0; i < 2; i++) { const h = g.randomEmptyNeighbor(self); if (h) g.summon('g_pup', self.owner, h); } } },
  { id: 'g_pup', name: 'Wolf Pup', color: 'grove', type: 'unit', cost: 1, atk: 2, hp: 1, icon: '🐕', text: '', token: true },
  { id: 'g_behemoth', name: 'Moss Behemoth', color: 'grove', type: 'unit', cost: 5, atk: 5, hp: 6, kw: ['regenerate'], icon: '🦍', text: '' },
  { id: 'g_dragon', name: 'Verdant Dragon', color: 'grove', type: 'unit', cost: 7, atk: 6, hp: 6, kw: ['flying'], icon: '🐉',
    text: 'Arrival: Heal your Sanctum by 5.', onPlay: (g, { p }) => g.healSanctum(p, 5) },
  { id: 'g_titan', name: 'Worldroot Titan', color: 'grove', type: 'unit', cost: 9, atk: 10, hp: 10, kw: ['guardian', 'regenerate'], icon: '🌲',
    text: 'Arrival: Root all enemy units until the end of next round.',
    onPlay: (g, { p }) => { g.fx('roots', null); for (const u of g.unitsOf(1 - p)) g.root(u, 2); } },

  // ───────────────────────────── DAWN ─────────────────────────────
  // Order, unity, protection. Shields, healing and an army that is stronger together.
  { id: 'd_recruit', name: 'Militia Recruit', color: 'dawn', type: 'unit', cost: 1, atk: 1, hp: 1, icon: '🪖', text: '', token: true },
  { id: 'd_squire', name: 'Eager Squire', color: 'dawn', type: 'unit', cost: 1, atk: 1, hp: 2, icon: '🧑‍🌾',
    text: 'Arrival: Summon a 1/1 Militia Recruit next to this.',
    onPlay: (g, { self }) => { if (!self) return; const h = g.randomEmptyNeighbor(self); if (h) g.summon('d_recruit', self.owner, h); } },
  { id: 'd_holy_light', name: 'Holy Light', color: 'dawn', type: 'spell', cost: 1, icon: '✨',
    text: 'Heal a friendly unit by 3 and give it Barrier.', targets: [friendlyUnit()],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.heal(u, 3); g.giveKw(u, 'barrier'); } } },
  { id: 'd_shieldmaiden', name: 'Shieldmaiden', color: 'dawn', type: 'unit', cost: 2, atk: 2, hp: 2, kw: ['guardian', 'barrier'], icon: '🛡️', text: '' },
  { id: 'd_archer', name: 'Lightwarden Archer', color: 'dawn', type: 'unit', cost: 2, atk: 2, hp: 1, range: 2, icon: '🏹', text: '' },
  { id: 'd_banner', name: 'Banner Knight', color: 'dawn', type: 'unit', cost: 3, atk: 2, hp: 3, icon: '🚩',
    text: 'Arrival: Give adjacent friendly units +1/+1.',
    onPlay: (g, { self }) => { if (!self) return; for (const u of g.adjacentUnits(self)) if (u.owner === self.owner) g.buff(u, 1, 1); } },
  { id: 'd_captain', name: 'Captain of the Guard', color: 'dawn', type: 'unit', cost: 3, atk: 3, hp: 3, icon: '🎖️',
    text: 'Whenever you summon another unit, give it +1/+1.',
    onFriendlySummon: (g, _self, other) => g.buff(other, 1, 1) },
  { id: 'd_call_arms', name: 'Call to Arms', color: 'dawn', type: 'spell', cost: 3, icon: '📣',
    text: 'Summon three 1/1 Militia Recruits in your deployment zone.',
    onPlay: (g, { p }) => g.summonInDeploy('d_recruit', p, 3) },
  { id: 'd_smite', name: 'Smite', color: 'dawn', type: 'spell', cost: 3, icon: '⚖️',
    text: 'Destroy an enemy unit with 4 or more power.',
    targets: [{ ...enemyUnit('Choose an enemy unit with 4+ power'), filter: (g, u) => g.power(u) >= 4 }],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.fx('holy', u); g.destroy(u); } } },
  { id: 'd_divine_aegis', name: 'Divine Aegis', color: 'dawn', type: 'spell', cost: 3, icon: '🔆',
    text: 'Give all friendly units Barrier.', onPlay: (g, { p }) => { for (const u of g.unitsOf(p)) g.giveKw(u, 'barrier'); } },
  { id: 'd_glorious', name: 'Glorious Charge', color: 'dawn', type: 'order', cost: 4, icon: '🎺',
    text: 'Friendly units get +2 power this round.',
    onPlay: (g, { p }) => { for (const u of g.unitsOf(p)) g.tempBuff(u, 2); } },
  { id: 'd_paladin', name: 'Dawnblade Paladin', color: 'dawn', type: 'unit', cost: 4, atk: 3, hp: 4, kw: ['firstStrike'], icon: '⚔️',
    text: 'Arrival: Heal your Sanctum by 3.', onPlay: (g, { p }) => g.healSanctum(p, 3) },
  { id: 'd_bastion', name: 'Bastion Golem', color: 'dawn', type: 'unit', cost: 5, atk: 2, hp: 8, kw: ['guardian'], icon: '🏛️',
    text: 'At the start of each round, give adjacent friendly units Barrier.',
    onRoundStart: (g, self) => { for (const u of g.adjacentUnits(self)) if (u.owner === self.owner) g.giveKw(u, 'barrier'); } },
  { id: 'd_seraph', name: 'Seraph of Dawn', color: 'dawn', type: 'unit', cost: 6, atk: 5, hp: 5, kw: ['flying', 'barrier'], icon: '👼',
    text: 'Arrival: Heal all friendly units and your Sanctum by 3.',
    onPlay: (g, { p }) => { g.fx('holy', null, { p }); for (const u of g.unitsOf(p)) g.heal(u, 3); g.healSanctum(p, 3); } },

  // ───────────────────────────── DUSK ─────────────────────────────
  // Ambition, death, sacrifice. Every fallen ally is fuel for something worse.
  { id: 'k_skeleton', name: 'Skeleton', color: 'dusk', type: 'unit', cost: 1, atk: 1, hp: 1, icon: '💀', text: '', token: true },
  { id: 'k_grave_imp', name: 'Grave Imp', color: 'dusk', type: 'unit', cost: 1, atk: 1, hp: 1, icon: '😈',
    text: 'Last Breath: Deal 1 damage to the enemy Sanctum.', onDeath: (g, self) => g.damageSanctum(1 - self.owner, 1) },
  { id: 'k_dark_pact', name: 'Dark Pact', color: 'dusk', type: 'spell', cost: 1, icon: '📜',
    text: 'Sacrifice a friendly unit. Draw 2 cards.', targets: [friendlyUnit('Choose a unit to sacrifice')],
    onPlay: (g, { targets, p }) => { const u = g.tUnit(targets[0]); if (u) { g.destroy(u); g.draw(p, 2); } } },
  { id: 'k_plague_rat', name: 'Plague Rat', color: 'dusk', type: 'unit', cost: 2, atk: 1, hp: 1, kw: ['deadly'], icon: '🐀', text: '' },
  { id: 'k_cultist', name: 'Blood Cultist', color: 'dusk', type: 'unit', cost: 2, atk: 2, hp: 2, icon: '🩸',
    text: 'Arrival: You may sacrifice an adjacent friendly unit. If you do, this gets +3/+3.',
    targets: [{ kind: 'unit', side: 'friendly', optional: true, prompt: 'Sacrifice an adjacent ally? (optional)', filter: adjToDeploy }],
    onPlay: (g, { targets, self }) => { const u = g.tUnit(targets[0]); if (u && self) { g.destroy(u); g.buff(self, 3, 3); } } },
  { id: 'k_bone_horde', name: 'Bone Horde', color: 'dusk', type: 'spell', cost: 2, icon: '🦴',
    text: 'Summon two 1/1 Skeletons in your deployment zone.', onPlay: (g, { p }) => g.summonInDeploy('k_skeleton', p, 2) },
  { id: 'k_siphon', name: 'Soul Siphon', color: 'dusk', type: 'unit', cost: 3, atk: 1, hp: 4, range: 2, icon: '🕯️',
    text: 'Whenever another friendly unit dies, deal 1 damage to the enemy Sanctum and heal yours by 1.',
    onUnitDeath: (g, self, dead) => { if (dead.owner === self.owner) { g.damageSanctum(1 - self.owner, 1, null); g.healSanctum(self.owner, 1); } } },
  { id: 'k_assassin', name: 'Shadow Assassin', color: 'dusk', type: 'unit', cost: 3, atk: 2, hp: 2, kw: ['deadly', 'infiltrate'], icon: '🥷', text: '' },
  { id: 'k_wraith', name: 'Hungering Wraith', color: 'dusk', type: 'unit', cost: 3, atk: 2, hp: 3, kw: ['flying', 'drain'], icon: '👻', text: '' },
  { id: 'k_embrace', name: "Death's Embrace", color: 'dusk', type: 'spell', cost: 2, icon: '🖤',
    text: 'Destroy a damaged enemy unit.',
    targets: [{ ...enemyUnit('Choose a damaged enemy unit'), filter: (_g, u) => u.hp < u.maxHp }],
    onPlay: (g, { targets }) => { const u = g.tUnit(targets[0]); if (u) { g.fx('shadow', u); g.destroy(u); } } },
  { id: 'k_necromancer', name: 'Necromancer', color: 'dusk', type: 'unit', cost: 4, atk: 2, hp: 4, icon: '🧟',
    text: 'Whenever another friendly non-Skeleton unit dies, summon a 1/1 Skeleton in its place.',
    onUnitDeath: (g, self, dead) => { if (dead.owner === self.owner && dead.cardId !== 'k_skeleton' && g.isEmpty(dead)) g.summon('k_skeleton', self.owner, dead); } },
  { id: 'k_vampire', name: 'Vampire Noble', color: 'dusk', type: 'unit', cost: 4, atk: 4, hp: 4, kw: ['drain'], icon: '🧛', text: '' },
  { id: 'k_raise_dead', name: 'Raise Dead', color: 'dusk', type: 'spell', cost: 3, icon: '⚰️',
    text: 'Summon a copy of the last friendly unit that died this game in your deployment zone.',
    targets: [{ kind: 'hex', prompt: 'Choose a hex in your deployment zone', hexFilter: (g, h, p) => g.isDeployHex(p, h) && g.s.players[p].graveyard.length > 0 }],
    onPlay: (g, { targets, p }) => { const h = hexOf(targets[0]); const gy = g.s.players[p].graveyard; if (h && gy.length) { g.fx('shadow', h); g.summon(gy[gy.length - 1], p, h); } } },
  { id: 'k_final_rite', name: 'Final Rite', color: 'dusk', type: 'spell', cost: 4, icon: '🌑',
    text: 'Sacrifice all friendly units. Deal 2 damage to the enemy Sanctum for each.',
    onPlay: (g, { p }) => { const us = g.unitsOf(p); g.fx('shadow', null, { p }); for (const u of us) g.destroy(u); g.damageSanctum(1 - p, 2 * us.length); } },
  { id: 'k_lich', name: 'Lich Queen', color: 'dusk', type: 'unit', cost: 7, atk: 5, hp: 6, kw: ['drain'], icon: '👑',
    text: 'Arrival: Destroy all other units with 2 or less health.',
    onPlay: (g, { self }) => { g.fx('shadow', null); for (const u of [...g.s.units]) if (u !== self && u.hp <= 2) g.destroy(u); } },
];

export const CARDS: Record<string, CardDef> = Object.fromEntries(list.map((c) => [c.id, c]));
export const ALL_CARDS = list;

export const COLOR_INFO: Record<Color, { name: string; hex: string; orb: string; ideals: string; style: string }> = {
  ember: { name: 'Ember', hex: '#ff5a2a', orb: 'Orb of Passion', ideals: 'Freedom, fury, the thrill of the moment.',
    style: 'Swift units that act immediately, Siege, and burn that goes straight for the enemy Sanctum.' },
  tide: { name: 'Tide', hex: '#2aa8ff', orb: 'Orb of Insight', ideals: 'Knowledge, patience, control.',
    style: 'Freezes, bounces and repositions enemies, draws cards, and wins late with huge sea monsters.' },
  grove: { name: 'Grove', hex: '#4fd16a', orb: 'Orb of Life', ideals: 'Growth, instinct, endurance.',
    style: 'Ramps extra mana into enormous creatures, Regenerates, and makes its units fight.' },
  dawn: { name: 'Dawn', hex: '#ffd34d', orb: 'Orb of Order', ideals: 'Unity, justice, protection.',
    style: 'Guardians and Barriers, healing, and a wide army of soldiers that buff each other.' },
  dusk: { name: 'Dusk', hex: '#b05cff', orb: 'Orb of Ambition', ideals: 'Power at any price.',
    style: 'Sacrifices its own units for value, Drains life, Deadly assassins, and death-trigger combos.' },
  neutral: { name: 'Neutral', hex: '#aaaaaa', orb: '', ideals: '', style: '' },
};

export const KEYWORD_INFO: Record<Keyword, { name: string; text: string; icon: string }> = {
  swift: { name: 'Swift', text: 'Can be ordered the round it is summoned.', icon: '💨' },
  guardian: { name: 'Guardian', text: 'Enemy units that move next to it must stop. Flying units ignore this.', icon: '🛡️' },
  flying: { name: 'Flying', text: 'Moves over other units and ignores Guardians.', icon: '🪽' },
  firstStrike: { name: 'First Strike', text: 'Deals its combat damage first. If that kills, it takes none back.', icon: '🗡️' },
  drain: { name: 'Drain', text: 'Damage it deals heals your Sanctum.', icon: '🩸' },
  regenerate: { name: 'Regenerate', text: 'Fully heals at the end of each round.', icon: '♻️' },
  barrier: { name: 'Barrier', text: 'Negates the next damage it would take, then breaks.', icon: '🔰' },
  siege: { name: 'Siege', text: 'Deals double damage to Sanctums.', icon: '🏰' },
  deadly: { name: 'Deadly', text: 'Destroys any unit it damages.', icon: '☠️' },
  infiltrate: { name: 'Infiltrate', text: 'Can be summoned on any empty hex in your half of the board, including Ley Orbs.', icon: '👁️' },
};

export function cardDef(id: string): CardDef {
  const d = CARDS[id];
  if (!d) throw new Error(`Unknown card ${id}`);
  return d;
}

